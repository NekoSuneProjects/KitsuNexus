const sequelize = require('./sequelize')
const User = require('./models/User')
const Device = require('./models/Device')
const Favorite = require('./models/Favorite')
const DiscordLink = require('./models/DiscordLink')
const WorldVisit = require('./models/WorldVisit')
const ApiKey = require('./models/ApiKey')

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

// Single placeholder account every Device/Favorite attaches to until real accounts exist.
// Fixed id so restarts don't create duplicates.
async function ensureStubUser () {
  const [user] = await User.findOrCreate({
    where: { id: STUB_USER_ID },
    defaults: { id: STUB_USER_ID, displayName: 'Local Owner', isStub: true },
  })
  return user
}

module.exports = { sequelize, User, Device, Favorite, DiscordLink, WorldVisit, ApiKey, ensureStubUser, STUB_USER_ID, init }
