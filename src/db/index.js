const sequelize = require('./sequelize')
const User = require('./models/User')
const Device = require('./models/Device')
const Favorite = require('./models/Favorite')
const DiscordLink = require('./models/DiscordLink')
const WorldVisit = require('./models/WorldVisit')
const ApiKey = require('./models/ApiKey')
const Entity = require('./models/Entity')
const ShareLink = require('./models/ShareLink')
const OverlayStatus = require('./models/OverlayStatus')
const RankScore = require('./models/RankScore')
const GuildRankRole = require('./models/GuildRankRole')
const BannedIdentity = require('./models/BannedIdentity')
const { generateOverlayId } = require('../auth/deviceToken')
const config = require('../config')

const STUB_USER_ID = '00000000-0000-0000-0000-000000000001'

async function init () {
  // No formal migration framework yet (fine for a single self-hosted instance) — but we do NOT
  // use sync({ alter: true }): on SQLite, "alter" a column by rebuilding the whole table via
  // CREATE + INSERT SELECT + DROP + RENAME, which both risks data loss if it's interrupted
  // partway and fails outright once another table (Device, Favorite, DiscordLink, WorldVisit,
  // ApiKey) holds a foreign key into it, since SQLite won't DROP a table something still
  // references. Plain sync() only CREATEs tables that don't exist yet — it never touches an
  // existing table — and addMissingColumns() below handles new model fields with plain,
  // non-destructive ALTER TABLE ADD COLUMN statements instead.
  await dropStaleBackupTables()
  await sequelize.sync()
  await addMissingColumns()
  await backfillOverlayIds()
  await syncOfficialRankRolesFromEnv()
  await ensureStubUser()
}

// Leftover from old deploys that ran sync({ alter: true }) before this version: if that process
// crashed mid-rebuild, a `<Table>_backup` table can be left behind with stale data in it,
// tripping up anything that later touches the real table. Harmless to keep clearing this even
// though nothing creates these tables anymore.
async function dropStaleBackupTables () {
  const [tables] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_backup' ESCAPE '\\'"
  )
  for (const { name } of tables) {
    await sequelize.query(`DROP TABLE IF EXISTS \`${name}\``)
  }
}

// Adds any model field that isn't yet a column on its table — e.g. oidcIssuer/oidcSub/role
// added after Users already existed in deployed databases. Only ever ADDs columns, via plain
// ALTER TABLE ADD COLUMN (SQLite supports this natively, no table rebuild involved); it never
// alters or drops an existing column, so it can't lose data or hit the foreign-key DROP problem
// above. A `unique: true` field is added without the inline UNIQUE (SQLite disallows a UNIQUE
// column in ADD COLUMN) and gets an equivalent unique index instead.
async function addMissingColumns () {
  const queryInterface = sequelize.getQueryInterface()
  for (const model of Object.values(sequelize.models)) {
    const tableName = model.getTableName()
    const existingColumns = await queryInterface.describeTable(tableName)
    for (const attribute of Object.values(model.getAttributes())) {
      const columnName = attribute.field || attribute.fieldName
      if (existingColumns[columnName]) continue
      const { unique, ...columnDef } = attribute
      await queryInterface.addColumn(tableName, columnName, columnDef)
      if (unique) {
        await queryInterface.addIndex(tableName, [columnName], { unique: true })
      }
    }
  }
}

// User.overlayId can't get a real value from addMissingColumns() — SQLite's ADD COLUMN only
// ever takes one literal DEFAULT for every existing row, and a unique per-row random id is
// exactly what it can't express. So the column lands NULL for any account that existed before
// this version, and this backfills each of them individually (a handful of rows at most on a
// self-hosted instance — fine to just loop) so every account still ends up with an overlay URL.
async function backfillOverlayIds () {
  const withoutOverlayId = await User.findAll({ where: { overlayId: null } })
  for (const user of withoutOverlayId) {
    user.overlayId = generateOverlayId()
    await user.save()
  }
}

// Keeps the official guild's (config.discordOfficialGuildId) Discord role -> Community Rank
// mapping (GuildRankRole, read by services/discordRankSync.js) in sync with DISCORD_RANK_ROLES
// on every boot — ENV is the source of truth for that one guild specifically (self-hosters
// still configure their own guilds through Settings ▸ Discord). Runs every start, not just
// once: editing the env var and restarting is meant to be how you change it, and a rank
// removed from the env mapping has its role assignment removed here too, not left stale.
// DISCORD_RANK_ROLES is keyed by Discord role id, e.g. {"<roleId>":"veteran"} — GuildRankRole
// itself still keys on rankKey (its unique index), so this just reads the env mapping inverted.
async function syncOfficialRankRolesFromEnv () {
  const guildId = config.discordOfficialGuildId
  if (!guildId) return
  const mapping = config.discordRankRoles || {}
  const rankKeyForRole = new Map(Object.entries(mapping))
  const rankKeys = new Set(rankKeyForRole.values())
  for (const [discordRoleId, rankKey] of rankKeyForRole) {
    if (!discordRoleId || !rankKey) continue
    const [row] = await GuildRankRole.findOrCreate({ where: { guildId, rankKey }, defaults: { guildId, rankKey, discordRoleId } })
    if (row.discordRoleId !== discordRoleId) await row.update({ discordRoleId })
  }
  const existing = await GuildRankRole.findAll({ where: { guildId } })
  for (const row of existing) {
    if (!rankKeys.has(row.rankKey)) await row.destroy()
  }
}

// Single placeholder account every Device/Favorite attaches to until real accounts exist.
// Fixed id so restarts don't create duplicates.
async function ensureStubUser () {
  const [user] = await User.findOrCreate({
    where: { id: STUB_USER_ID },
    defaults: { id: STUB_USER_ID, displayName: 'Local Owner', isStub: true, overlayId: generateOverlayId() },
  })
  return user
}

module.exports = { sequelize, User, Device, Favorite, DiscordLink, WorldVisit, ApiKey, Entity, ShareLink, OverlayStatus, RankScore, GuildRankRole, BannedIdentity, ensureStubUser, STUB_USER_ID, init }
