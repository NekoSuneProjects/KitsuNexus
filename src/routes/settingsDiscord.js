const express = require('express')
const { DiscordLink } = require('../db')
const requireAuth = require('../middleware/requireAuth')
const asyncHandler = require('../utils/asyncHandler')
const config = require('../config')
const authorizedGuilds = require('../discord/authorizedGuilds')
const botGateway = require('../discord/discordBotGateway')

const router = express.Router()

router.get('/settings/discord', requireAuth, asyncHandler(async (req, res) => {
  const link = await DiscordLink.findOne({ where: { userId: req.user.id } })
  let guilds = []
  if (link) {
    const mine = Object.entries(authorizedGuilds.all()).filter(([, v]) => v.authorizedBy === link.discordId)
    guilds = await Promise.all(mine.map(async ([id, v]) => ({
      id, authorizedAt: v.at, canManage: await botGateway.hasManagePermission(id, link.discordId),
    })))
  }
  res.render('settings-discord', {
    title: 'Discord — KitsuNexus',
    link,
    guilds,
    discordConfigured: !!(config.discordClientId && config.discordClientSecret && config.discordRedirectUri),
  })
}))

router.post('/settings/discord/unlink', requireAuth, asyncHandler(async (req, res) => {
  await DiscordLink.destroy({ where: { userId: req.user.id } })
  res.redirect('/settings/discord')
}))

// Removing the bot from a guild. Re-checks Manage Server live server-side — never trust that
// the "Remove" button was correctly hidden client-side.
router.post('/settings/discord/guilds/:guildId/revoke', requireAuth, asyncHandler(async (req, res) => {
  const link = await DiscordLink.findOne({ where: { userId: req.user.id } })
  if (link && await botGateway.hasManagePermission(req.params.guildId, link.discordId)) {
    authorizedGuilds.revoke(req.params.guildId)
    await botGateway.leaveGuild(req.params.guildId)
  }
  res.redirect('/settings/discord')
}))

module.exports = router
