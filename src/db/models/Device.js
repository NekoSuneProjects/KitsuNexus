const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// A paired KitsuNexus desktop (or future mobile) install. Pairing flow: the app asks for a
// short-lived `pairingCode`, the website "claims" it (attaching userId + issuing tokenHash),
// then the app authenticates future API calls with the token that hashes to `tokenHash`
// (only the hash is stored — see src/auth/deviceToken.js).
const Device = sequelize.define('Device', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false, defaultValue: 'KitsuNexus Desktop' },
  status: { type: DataTypes.ENUM('pending', 'paired'), allowNull: false, defaultValue: 'pending' },
  pairingCode: { type: DataTypes.STRING, allowNull: true },
  pairingCodeExpiresAt: { type: DataTypes.DATE, allowNull: true },
  tokenHash: { type: DataTypes.STRING, allowNull: true, unique: true },
  lastSeenAt: { type: DataTypes.DATE, allowNull: true },
})

Device.belongsTo(User, { foreignKey: 'userId' })

module.exports = Device
