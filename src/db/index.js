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
  await sequelize.sync({ alter: true })
  await ensureStubUser()
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
