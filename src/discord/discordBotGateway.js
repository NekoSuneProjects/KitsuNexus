// Persistent gateway connection for the shared/official KitsuNexus Discord bot.
// Server-side twin of modules/vrchat/assistant/../integrations/discord bits in the Electron
// app, generalized from "watch one user" to "answer lookups for any user/channel" since this
// backend serves every installed copy of the app.
//
// Deliberately does NOT hand-roll a channel/voice-state cache: discord.js already
// maintains guild.voiceStates.cache (and VoiceChannel#members derived from it) live
// from gateway events, so lookups just read straight from discord.js's own cache.
//
// Ported from NekoSuneAPPS/server/src/discordBotGateway.js — logic unchanged, only the
// config import path and the "NekoSuneAPPS" → "KitsuNexus" audit-log wording differ.

const { Client, GatewayIntentBits, Events, PermissionFlagsBits, ActivityType } = require('discord.js')
const config = require('../config')
const authorizedGuilds = require('./authorizedGuilds')

let client = null
let ready = false
let lastError = null
let retryTimer = null
let retryDelayMs = 0
let statusTimer = null
let statusIndex = 0

// Guards against a real race: Discord adds the bot to the guild (firing
// GuildCreate over the gateway) as part of the SAME consent click that then
// redirects the browser back to /oauth2/discord/callback, which is what
// actually records the authorization (authorizedGuilds.authorize()). Those
// two arrive over completely independent channels with no ordering
// guarantee — the gateway event can and does win the race in practice,
// which would otherwise kick a guild that's about to be legitimately
// authorized seconds later. Give the callback a grace window before
// enforcing on a freshly-joined guild; the retroactive startup sweep below
// doesn't need one, since there's no in-flight callback to race against
// for guilds the bot was already sitting in when it started.
const JOIN_GRACE_MS = 15_000

// Only /oauth2/discord/authorize-bot is allowed to let a guild keep the bot —
// leave anything else, whether it's a guild added before this whitelist
// existed or one added via a leaked raw invite link. The official KitsuNexus
// guild (config.discordOfficialGuildId) is exempt regardless of how the bot
// got there or whether it's in the persisted whitelist file at all.
async function enforceWhitelist (guild) {
  if (config.discordOfficialGuildId && guild.id === config.discordOfficialGuildId) return
  if (authorizedGuilds.isAuthorized(guild.id)) return
  console.warn(`[discordBotGateway] leaving unauthorized guild "${guild.name}" (${guild.id}) — never went through /oauth2/discord/authorize-bot`)
  try { await guild.leave() } catch (err) { console.warn('[discordBotGateway] failed to leave guild:', err.message) }
}

// Rotating "Watching …" presence — nothing sensitive, just aggregate counts: how many guilds
// the bot is in, and how many distinct accounts have a paired desktop app (i.e. people actually
// using KitsuNexus, not just registered on the website). Recomputed on every rotation rather
// than cached, so the numbers stay live without a separate refresh mechanism.
const STATUS_ROTATE_MS = 30_000
async function statusTexts () {
  const guildCount = client ? client.guilds.cache.size : 0
  let userCount = 0
  try {
    // Lazy-required like the GuildBanAdd handler above — avoids a require() cycle with db/index.js.
    const { Device } = require('../db')
    userCount = await Device.count({ where: { status: 'paired' }, distinct: true, col: 'userId' })
  } catch (_) { /* DB not ready yet, or this call raced startup — just skip this rotation */ }
  return [
    `${guildCount} ${guildCount === 1 ? 'guild' : 'guilds'} connected`,
    `${userCount} ${userCount === 1 ? 'person' : 'people'} using KitsuNexus`,
  ]
}
async function rotateStatus () {
  if (!client || !ready || !client.user) return
  const texts = await statusTexts()
  const text = texts[statusIndex % texts.length]
  statusIndex = (statusIndex + 1) % texts.length
  try { client.user.setActivity(text, { type: ActivityType.Watching }) } catch (_) {}
}
function startStatusRotation () {
  clearInterval(statusTimer)
  rotateStatus()
  statusTimer = setInterval(rotateStatus, STATUS_ROTATE_MS)
}
function stopStatusRotation () {
  clearInterval(statusTimer)
  statusTimer = null
}

async function start () {
  if (!config.discordBotToken) throw new Error('DISCORD_BOT_TOKEN not set — Discord bot disabled')
  // A retried attempt (startWithRetry) leaves the previous failed client instance and its
  // listeners/socket dangling otherwise.
  if (client) { try { client.destroy() } catch (_) {} }
  stopStatusRotation()
  ready = false
  client = new Client({
    // GuildModeration is what actually delivers GuildBanAdd over the gateway — without it the
    // event below silently never fires, no error, nothing to notice until someone asks "why
    // didn't banning them on Discord also erase their KitsuNexus data?".
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
    // 'invisible' here (ported as-is from NekoSuneAPPS/server) made the bot show offline in
    // every guild it's in — fine for a background integration nobody's meant to notice, but not
    // for the official guild where members should be able to see it's actually running.
    presence: { status: 'online', activities: [{ name: 'starting up…', type: ActivityType.Watching }] }
  })
  client.once(Events.ClientReady, () => {
    ready = true
    console.log(`[discordBotGateway] logged in as ${client.user.tag}`)
    // Retroactive sweep, e.g. after this whitelist was added to an
    // already-running bot, or if the authorized-guilds data volume was lost.
    for (const guild of client.guilds.cache.values()) enforceWhitelist(guild)
    startStatusRotation()
  })
  // Fires the moment the bot is added to any guild, authorized or not —
  // delayed so /oauth2/discord/authorize-bot's callback has a chance to win.
  client.on(Events.GuildCreate, guild => setTimeout(() => enforceWhitelist(guild), JOIN_GRACE_MS))
  // A staff member banning someone directly on Discord (for harassment, etc.) should have the
  // same effect as banning them through /admin — permanently ban + erase their KitsuNexus data
  // too, if that Discord identity happens to be linked to an account. Lazy-required to avoid a
  // require() cycle (banUser -> this file, for the reverse "ban them on Discord too" direction).
  client.on(Events.GuildBanAdd, async ban => {
    try {
      const { DiscordLink } = require('../db')
      const link = await DiscordLink.findOne({ where: { discordId: ban.user.id } })
      if (!link) return
      const { banUser } = require('../services/banUser')
      console.log(`[discordBotGateway] linked account banned on Discord (guild ${ban.guild.id}) — erasing KitsuNexus data for user ${link.userId}`)
      await banUser(link.userId, `Banned on Discord in guild ${ban.guild.id}`, `discord:${ban.guild.id}`)
    } catch (err) { console.warn('[discordBotGateway] guildBanAdd auto-erase failed:', err.message) }
  })
  client.on(Events.Error, err => console.warn('[discordBotGateway] error:', err.message))
  try {
    await client.login(config.discordBotToken)
  } catch (err) {
    // "Used disallowed intents" is by far the most common reason this fails on a first setup —
    // this bot requests GuildMembers and GuildModeration, both of which Discord treats as
    // privileged and OFF by default; they have to be turned on for this specific application at
    // https://discord.com/developers/applications, under Bot ▸ Privileged Gateway Intents
    // ("Server Members Intent"). A bad/regenerated token is the other common cause.
    if (err && /disallowed intents/i.test(err.message)) {
      throw new Error('Discord rejected the bot\'s intents — enable "Server Members Intent" (and "Guild Moderation" if shown) for this bot at https://discord.com/developers/applications ▸ your app ▸ Bot ▸ Privileged Gateway Intents, then it will pick this up on its next automatic retry.')
    }
    throw err
  }
  return client
}

// Keeps retrying instead of giving up forever after one failure (a bad token or missing
// privileged intent used to mean the bot silently stayed dead until the process was restarted
// — see startWithRetry below). Exponential backoff, capped at 5 minutes, reset to the initial
// delay on any successful login.
const RETRY_INITIAL_MS = 30_000
const RETRY_MAX_MS = 5 * 60_000
async function startWithRetry () {
  try {
    await start()
    lastError = null
    retryDelayMs = 0
  } catch (err) {
    lastError = err.message
    console.error(`[discordBotGateway] failed to start (retrying in ${Math.round((retryDelayMs || RETRY_INITIAL_MS) / 1000)}s):`, err.message)
    retryDelayMs = retryDelayMs ? Math.min(retryDelayMs * 2, RETRY_MAX_MS) : RETRY_INITIAL_MS
    clearTimeout(retryTimer)
    retryTimer = setTimeout(startWithRetry, retryDelayMs)
  }
}

function isReady () { return ready }
// Whether the bot is CURRENTLY sitting in this guild right now — different from "authorized"
// (authorizedGuilds.isAuthorized), which just means it's allowed to be; the bot could've been
// kicked, or the guild deleted, without that whitelist entry ever being cleaned up.
function isInGuild (guildId) { return !!(client && client.guilds.cache.has(guildId)) }
function getLastError () { return lastError }

// Used by /settings/discord's "Remove" action: revoking a guild in
// authorizedGuilds.js only updates the persisted list — this is what
// actually makes the bot leave right away instead of waiting for it to be
// re-added (or a restart) to notice it's no longer authorized.
async function leaveGuild (guildId) {
  const guild = client && client.guilds.cache.get(guildId)
  if (!guild) return { ok: false, error: 'Bot is not currently in that guild' }
  try {
    await guild.leave()
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}

// Gates /settings/discord's "Remove" action: only someone who CURRENTLY holds
// Manage Server (or Administrator, or is the guild owner) in this guild may
// revoke it — not just whoever originally authorized it, since admin rights
// are a property of the server, not of who happened to click "invite" first.
// Live-fetched rather than read from cache, since the acting member may not
// already be cached. Adding the bot doesn't need this same check here:
// Discord's own OAuth consent screen already restricts the guild picker in
// /oauth2/discord/authorize-bot to guilds where the authorizing user has
// Manage Server — there's no separate "add" gate to enforce on our side.
async function hasManagePermission (guildId, discordUserId) {
  const guild = client && client.guilds.cache.get(guildId)
  if (!guild) return false
  try {
    const member = await guild.members.fetch(discordUserId)
    return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator)
  } catch (_) {
    return false // not a member of the guild (or fetch failed) — no permission
  }
}

// Mirrors the Electron app's per-user Discord bot voice-state read, generalized to any userId.
// First guild match wins — same accepted ambiguity as the existing per-user bot.
function getUserVoiceState (userId) {
  const state = {
    inVoice: false, channelName: '', userCount: 0,
    selfMute: false, selfDeaf: false, guildId: ''
  }
  if (!client) return state
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId)
    const vs = member && member.voice
    if (vs && vs.channelId && vs.channel) {
      state.inVoice = true
      state.channelName = vs.channel.name
      state.userCount = vs.channel.members ? vs.channel.members.size : 0
      state.selfMute = !!(vs.selfMute || vs.serverMute)
      state.selfDeaf = !!(vs.selfDeaf || vs.serverDeaf)
      state.guildId = guild.id
      return state
    }
  }
  return state
}

// Used by the Activity iframe: who's in this voice channel right now.
function getChannelRoster (channelId) {
  if (!client) return null
  const channel = client.channels.cache.get(channelId)
  if (!channel || !channel.isVoiceBased?.()) return null
  return {
    guildId: channel.guildId,
    channelName: channel.name,
    userCount: channel.members.size,
    memberIds: [...channel.members.keys()]
  }
}

async function setMute (guildId, userId, mute) {
  const guild = client && client.guilds.cache.get(guildId)
  const member = guild && guild.members.cache.get(userId)
  if (!member) return { ok: false, error: 'Member not found' }
  try {
    await member.voice.setMute(!!mute, 'KitsuNexus official bot')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}

async function setDeaf (guildId, userId, deaf) {
  const guild = client && client.guilds.cache.get(guildId)
  const member = guild && guild.members.cache.get(userId)
  if (!member) return { ok: false, error: 'Member not found' }
  try {
    await member.voice.setDeaf(!!deaf, 'KitsuNexus official bot')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}

// Community Ranks role sync (services/discordRankSync.js): removes every OTHER configured
// rank role the member currently holds in this guild, then adds the one for their new rank
// (skips the add if `addRoleId` is null, e.g. no mapping configured for that rank yet). Doing
// the remove+add together, rather than just adding, is what makes an upgrade/downgrade actually
// swap the badge instead of piling up every rank they've ever held.
async function setMemberRankRole (guildId, discordUserId, addRoleId, allRankRoleIds) {
  const guild = client && client.guilds.cache.get(guildId)
  if (!guild) return { ok: false, error: 'Bot is not in that guild' }
  const member = await guild.members.fetch(discordUserId).catch(() => null)
  if (!member) return { ok: false, error: 'Member not found in guild' }
  const toRemove = allRankRoleIds.filter(id => id !== addRoleId && member.roles.cache.has(id))
  for (const roleId of toRemove) {
    await member.roles.remove(roleId, 'KitsuNexus Community Rank changed').catch(() => {})
  }
  if (addRoleId && !member.roles.cache.has(addRoleId)) {
    await member.roles.add(addRoleId, 'KitsuNexus Community Rank').catch(() => {})
  }
  return { ok: true }
}

// Bans a Discord identity from the official KitsuNexus guild only (config.discordOfficialGuildId)
// — used by services/banUser.js. Deliberately scoped to just that one guild, not every guild
// the bot happens to be authorized in: a self-hoster's own guild shouldn't have someone banned
// on it just because they got permanently banned from the official one. Best-effort — requires
// the bot to actually hold Ban Members there; silently skipped otherwise (logged by the caller).
async function banFromOfficialGuild (discordUserId, reason) {
  if (!client || !config.discordOfficialGuildId) return
  const guild = client.guilds.cache.get(config.discordOfficialGuildId)
  if (!guild) return
  await guild.members.ban(discordUserId, { reason: reason || 'Banned from KitsuNexus' })
}

module.exports = { start, startWithRetry, isReady, isInGuild, getLastError, getUserVoiceState, getChannelRoster, setMute, setDeaf, leaveGuild, hasManagePermission, setMemberRankRole, banFromOfficialGuild }
