const sequelize = require('./sequelize')
const User = require('./models/User')
const Device = require('./models/Device')
const Favorite = require('./models/Favorite')
const DiscordLink = require('./models/DiscordLink')
const WorldVisit = require('./models/WorldVisit')
const ApiKey = require('./models/ApiKey')

const STUB_USER_ID = '00000000-0000-0000-0000-000000000001'

async function init () {
  // alter:true while the schema is still actively changing (no migrations yet) — fine for a
  // single self-hosted instance, but swap to real migrations before this handles other people's data.
  await dropStaleBackupTables()
  await sequelize.sync({ alter: true })
  await ensureStubUser()
}

// sequelize's SQLite alter strategy rebuilds a changed table via CREATE TABLE <Table>_backup,
// INSERT INTO <Table>_backup SELECT ... FROM <Table>, then DROP + RENAME. If the process is
// killed between the CREATE and the final RENAME (e.g. crashed/restarted mid-sync), the backup
// table survives with a copy of the old data still in it. The next boot's alter then tries to
// INSERT into that same leftover table again and hits a duplicate primary key, crash-looping
// forever. Clear out any such leftovers before syncing so a crash mid-migration is recoverable.
async function dropStaleBackupTables () {
  const [tables] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_backup' ESCAPE '\\'"
  )
  for (const { name } of tables) {
    await sequelize.query(`DROP TABLE IF EXISTS \`${name}\``)
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
