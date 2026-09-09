const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')

// Per-guild config: which Discord role id corresponds to which KitsuNexus Community Rank tier
// in THAT guild. Deliberately per-guild, not a single global mapping — this backend serves
// every self-hosted install's authorized guilds (src/discord/authorizedGuilds.js), each of
// which has its own roles. Managed from /settings/discord by whoever can currently manage that
// guild (discordBotGateway.hasManagePermission), same gate as removing the bot.
const GuildRankRole = sequelize.define('GuildRankRole', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  guildId: { type: DataTypes.STRING, allowNull: false },
  rankKey: { type: DataTypes.STRING, allowNull: false },
  discordRoleId: { type: DataTypes.STRING, allowNull: false },
}, {
  indexes: [{ unique: true, fields: ['guildId', 'rankKey'] }],
})

module.exports = GuildRankRole
