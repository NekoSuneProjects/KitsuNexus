const express = require('express')
const rateLimit = require('express-rate-limit')
const requireDiscordBearer = require('../discord/requireDiscordBearer')
const statusStore = require('../discord/statusStore')
const botGateway = require('../discord/discordBotGateway')

const router = express.Router()

// Public-facing (unlike most of this server's API, which a browser session gates) and fed by
// every installed copy of the app — keyed per authenticated Discord user so one client can't
// crowd out another.
const perUserLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: req => req.discordUserId,
  standardHeaders: true,
  legacyHeaders: false
})

// Same join/active/ask/busy privacy gate as the Electron app's own STATUS map — re-derived
// here rather than trusting the client to have already filtered it.
const WORLD_VISIBLE_STATUSES = new Set(['join', 'active'])

router.post('/api/status', requireDiscordBearer, perUserLimiter, express.json(), (req, res) => {
  const body = req.body || {}
  const worldVisible = !!body.showWorld && WORLD_VISIBLE_STATUSES.has(body.vrcStatus)
  statusStore.set(req.discordUserId, {
    worldName: worldVisible ? String(body.worldName || '').slice(0, 128) : '',
    joinUrl: worldVisible ? String(body.joinUrl || '').slice(0, 512) : '',
    worldUrl: worldVisible ? String(body.worldUrl || '').slice(0, 512) : '',
    profileUrl: String(body.profileUrl || '').slice(0, 512),
    hrBpm: body.showHeartRate ? Number(body.hrBpm) || 0 : 0,
    nowPlaying: body.showNowPlaying ? String(body.nowPlaying || '').slice(0, 256) : ''
  })
  res.json({ ok: true })
})

router.get('/api/channel/:channelId/status', requireDiscordBearer, (req, res) => {
  const roster = botGateway.getChannelRoster(req.params.channelId)
  if (!roster) return res.status(404).json({ error: 'Channel not found or not visible to the bot' })
  const members = roster.memberIds.map(userId => {
    const status = statusStore.get(userId)
    return { userId, visible: !!status, ...(status || {}) }
  })
  res.json({ channelName: roster.channelName, guildId: roster.guildId, userCount: roster.userCount, members })
})

// Voice-state/mute/deafen control is scoped to the caller's OWN Discord user — the bearer
// token only proves identity, not permission over anyone else, so :userId must match the
// authenticated caller or this would let any holder of a valid token query or mute/deafen
// a stranger.
function requireSelf (req, res, next) {
  if (req.params.userId !== req.discordUserId) return res.status(403).json({ error: 'Cannot act on another user' })
  next()
}

router.get('/api/bot/voice/:userId', requireDiscordBearer, requireSelf, (req, res) => {
  res.json(botGateway.getUserVoiceState(req.params.userId))
})

router.post('/api/bot/voice/:userId/mute', requireDiscordBearer, requireSelf, perUserLimiter, express.json(), async (req, res) => {
  const state = botGateway.getUserVoiceState(req.params.userId)
  if (!state.guildId) return res.status(409).json({ ok: false, error: 'Not in a voice channel' })
  const result = await botGateway.setMute(state.guildId, req.params.userId, !!(req.body || {}).mute)
  res.json(result)
})

router.post('/api/bot/voice/:userId/deaf', requireDiscordBearer, requireSelf, perUserLimiter, express.json(), async (req, res) => {
  const state = botGateway.getUserVoiceState(req.params.userId)
  if (!state.guildId) return res.status(409).json({ ok: false, error: 'Not in a voice channel' })
  const result = await botGateway.setDeaf(state.guildId, req.params.userId, !!(req.body || {}).deaf)
  res.json(result)
})

module.exports = router
