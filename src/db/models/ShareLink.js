const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// A shareable link to a cached world/avatar (routes/share.js) — hands anyone with the URL (no
// KitsuNexus account required) the public metadata cached in Entity, and lets a recipient's own
// paired device "claim" it into their own Favorites without ever touching the sharer's account,
// tokens, or requiring the two to be connected on this server in any other way.
const ShareLink = sequelize.define('ShareLink', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  type: { type: DataTypes.ENUM('world', 'avatar'), allowNull: false },
  vrchatId: { type: DataTypes.STRING, allowNull: false },
  createdByUserId: { type: DataTypes.UUID, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: true },
  revokedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [{ fields: ['type', 'vrchatId'] }],
})

ShareLink.belongsTo(User, { foreignKey: 'createdByUserId' })

module.exports = ShareLink
