const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// Links a website account to a Discord identity, created via /settings/discord (requires
// being logged in first — the callback reads the website session cookie to know who's
// linking). One Discord account can only ever back one website account, and vice versa.
const DiscordLink = sequelize.define('DiscordLink', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true },
  discordId: { type: DataTypes.STRING, allowNull: false, unique: true },
  discordUsername: { type: DataTypes.STRING, allowNull: true },
  discordAvatar: { type: DataTypes.STRING, allowNull: true },
})

DiscordLink.belongsTo(User, { foreignKey: 'userId' })

module.exports = DiscordLink
