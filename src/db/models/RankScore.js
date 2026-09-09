const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// A user's latest KitsuNexus Community Rank, pushed up from the Electron app's local
// rankEngine/rankDb (which computes the score from that install's own VRChat + local-history
// data — this table doesn't recompute anything, it's just where the result lands so it can
// back a real cross-user leaderboard and drive Discord role sync). One row per user,
// last-write-wins, same pattern as OverlayStatus.
const RankScore = sequelize.define('RankScore', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true },
  rankKey: { type: DataTypes.STRING, allowNull: false },
  finalScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  tier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
})

RankScore.belongsTo(User, { foreignKey: 'userId' })

module.exports = RankScore
