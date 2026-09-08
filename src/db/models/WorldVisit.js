const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// Cloud-synced mirror of the Electron app's local world-visit history (gamelog.js's 'world'
// events with a resolved wrld_… id). Append-only — visits are never edited or deleted, so
// unlike Favorite this has no soft-delete/tombstone; sync is push (dedupe by unique key below)
// + pull, no merge conflicts to resolve.
const WorldVisit = sequelize.define('WorldVisit', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  worldId: { type: DataTypes.STRING, allowNull: false },
  worldName: { type: DataTypes.STRING, allowNull: true },
  visitedAt: { type: DataTypes.DATE, allowNull: false },
}, {
  indexes: [{ unique: true, fields: ['userId', 'worldId', 'visitedAt'] }],
})

WorldVisit.belongsTo(User, { foreignKey: 'userId' })

module.exports = WorldVisit
