const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// Access and refresh tokens are encrypted before reaching SQLite.
const TwitchLink = sequelize.define('TwitchLink', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true },
  twitchId: { type: DataTypes.STRING, allowNull: false, unique: true },
  login: { type: DataTypes.STRING, allowNull: false },
  displayName: { type: DataTypes.STRING, allowNull: true },
  scopes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  encryptedAccessToken: { type: DataTypes.TEXT, allowNull: false },
  encryptedRefreshToken: { type: DataTypes.TEXT, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
})

TwitchLink.belongsTo(User, { foreignKey: 'userId' })

module.exports = TwitchLink
