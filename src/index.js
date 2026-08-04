const express = require('express')
const cors = require('cors')
const { port } = require('./config')
const botGateway = require('./discordBotGateway')
const oauthRoutes = require('./routes/oauth')
const statusRoutes = require('./routes/status')

function main () {
  const app = express()
  app.use(cors())
  app.get('/healthz', (req, res) => res.json({ ok: true, botReady: botGateway.isReady() }))
  app.use(oauthRoutes)
  app.use(statusRoutes)
  app.use('/activity', express.static('public/activity'))

  app.listen(port, () => console.log(`[nekosuneapps-discord-backend] listening on :${port}`))

  // Non-blocking: OAuth/status routes should stay up even if the bot token is
  // bad or Discord is briefly unreachable — a login retry shouldn't take the
  // whole API down with it.
  botGateway.start().catch(err => {
    console.error('[nekosuneapps-discord-backend] bot gateway failed to start (will not retry automatically):', err.message)
  })
}

main()
