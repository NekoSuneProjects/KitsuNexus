// modules/integrations/discord/discordRpc.js
// Discord Rich Presence - shows "Playing KitsuNexus" with live details on your
// Discord profile. Create an app at https://discord.com/developers/applications
// and paste its Application (Client) ID. Runs in the MAIN process.

let RPC
try {
  RPC = require('discord-rpc')
} catch (err) {
  console.warn('discord-rpc not installed yet:', err.message)
}

let client = null
let clientId = ''
let connected = false
let startTimestamp = null

async function startDiscordRpc (appClientId) {
  clientId = String(appClientId || '').trim()
  if (!RPC) throw new Error('discord-rpc not installed (run npm install)')
  if (!clientId) throw new Error('No Discord Application ID set')

  await stopDiscordRpc()

  client = new RPC.Client({ transport: 'ipc' })
  startTimestamp = Date.now()

  client.on('ready', () => {
    connected = true
    setActivity({ state: 'In VRChat', details: 'KitsuNexus running' })
  })

  await client.login({ clientId })
  return true
}

function setActivity ({ state, details } = {}) {
  if (!client || !connected) return
  client.setActivity({
    details: (details || 'KitsuNexus').slice(0, 128),
    state: (state || '').slice(0, 128),
    startTimestamp,
    largeImageKey: 'logo',
    largeImageText: 'KitsuNexus',
    instance: false
  }).catch(err => console.warn('Discord setActivity error:', err.message))
}

async function stopDiscordRpc () {
  connected = false
  if (client) {
    try { await client.destroy() } catch (_) { /* ignore */ }
    client = null
  }
}

function isConnected () {
  return connected
}

module.exports = { startDiscordRpc, stopDiscordRpc, setActivity, isConnected }
