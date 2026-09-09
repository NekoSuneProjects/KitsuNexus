const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')

// A permanent ban record, kept AFTER the offending account's own data has been erased (see
// services/accountErasure.js) — otherwise a permanently-banned harasser could just erase-and-
// re-register under the same email/Discord identity immediately. Deliberately minimal: no FK to
// User (that row is gone by the time this exists), just enough to block re-entry and keep an
// accountable record of why. Checked at registration (email) and Discord linking (discordId).
const BannedIdentity = sequelize.define('BannedIdentity', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: true },
  discordId: { type: DataTypes.STRING, allowNull: true },
  reason: { type: DataTypes.TEXT, allowNull: true },
  bannedBy: { type: DataTypes.STRING, allowNull: true },
})

module.exports = BannedIdentity
