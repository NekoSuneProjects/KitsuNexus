const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// Long-lived key for server-to-server pulls (e.g. an external avatar/world search site pulling
// the worlds feed — see routes/ownerApi.js) — deliberately separate from both the website
// session cookie and a paired Device's token, since this is meant to be held by another
// service, not a browser or the KitsuNexus app itself. Owner/admin only (see requireAdmin.js).
// Only the sha256 hash is stored — see auth/deviceToken.js's hashToken, reused here too.
const ApiKey = sequelize.define('ApiKey', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  label: { type: DataTypes.STRING, allowNull: false, defaultValue: 'API key' },
  keyHash: { type: DataTypes.STRING, allowNull: false, unique: true },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true },
})

ApiKey.belongsTo(User, { foreignKey: 'userId' })

module.exports = ApiKey
