const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')
const { port, discordInviteUrl } = require('./config')
const botGateway = require('./discordBotGateway')
const oauthRoutes = require('./routes/oauth')
const statusRoutes = require('./routes/status')
const dashboardRoutes = require('./routes/dashboard')

function main () {
  const app = express()
  // Trust the reverse proxy's X-Forwarded-Proto so req.secure reflects the
  // real client connection (HTTPS) rather than this container's own plain-HTTP
  // listener — the dashboard's session cookie is marked secure based on it.
  app.set('trust proxy', 1)
  // Reduces what a scanner can passively learn about this box (drops
  // X-Powered-By, sets sane default security headers) — this API has no
  // browser-rendered pages of its own besides the dashboard and the Activity
  // iframe, so helmet's defaults are fine as-is with no extra CSP tuning here.
  app.use(helmet())
  app.use(cors())
  app.use(cookieParser())

  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'))
  app.get('/', (req, res) => {
    if (discordInviteUrl) return res.redirect(discordInviteUrl)
    res.type('text/plain').send('NekoSuneAPPS backend.')
  })

  app.get('/healthz', (req, res) => res.json({ ok: true, botReady: botGateway.isReady() }))
  app.use(oauthRoutes)
  app.use(statusRoutes)
  app.use(dashboardRoutes)
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
