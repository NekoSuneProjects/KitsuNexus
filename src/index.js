const path = require('path')
const express = require('express')
const expressLayouts = require('express-ejs-layouts')
const helmet = require('helmet')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')
const config = require('./config')
const db = require('./db')
const pairingRoutes = require('./routes/pairing')
const favoritesSyncRoutes = require('./routes/favoritesSync')
const authRoutes = require('./routes/auth')
const dashboardRoutes = require('./routes/dashboard')
const adminRoutes = require('./routes/admin')
const discordOauthRoutes = require('./routes/discordOauth')
const discordStatusRoutes = require('./routes/discordStatus')
const settingsDiscordRoutes = require('./routes/settingsDiscord')
const zitadelAuthRoutes = require('./routes/zitadelAuth')
const currentUser = require('./middleware/currentUser')
const asyncHandler = require('./utils/asyncHandler')
const discordBotGateway = require('./discord/discordBotGateway')

const app = express()

app.use(helmet({
  // The hero banner/logo are same-origin static files, but keep this permissive enough
  // for inline <style> in views/layout.ejs — tighten once real user input touches pages.
  contentSecurityPolicy: false,
}))
app.use(cors())
app.use(cookieParser())
app.use(rateLimit({ windowMs: 60000, limit: 120 }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '..', 'views'))
app.use(expressLayouts)
app.set('layout', 'layout')

app.use(express.static(path.join(__dirname, '..', 'public')))

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.use(asyncHandler(currentUser))

app.get('/', (req, res) => {
  res.render('home', { title: 'KitsuNexus — Your VRChat Companion' })
})

app.use(authRoutes)
app.use(zitadelAuthRoutes)
app.use(dashboardRoutes)
app.use(adminRoutes)
app.use(settingsDiscordRoutes)
app.use(discordOauthRoutes)
app.use(discordStatusRoutes)
app.use(pairingRoutes)
app.use(favoritesSyncRoutes)

app.use((req, res) => res.status(404).render('404', { title: 'Not found — KitsuNexus' }))

// Sequelize errors (e.g. a malformed sync payload) shouldn't leak stack traces to API clients.
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ ok: false, error: 'Internal server error' })
})

db.init()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`KitsuNexus server listening on ${config.siteUrl} (port ${config.port})`)
    })
    // Non-blocking and optional: the rest of this server (accounts, Favorites sync) has to
    // keep working with no Discord app configured at all, or if the bot token is bad/Discord
    // is briefly unreachable — a login retry shouldn't take the whole site down with it.
    if (config.discordBotToken) {
      discordBotGateway.start().catch(err => {
        console.error('[discord] bot gateway failed to start (will not retry automatically):', err.message)
      })
    } else {
      console.log('[discord] DISCORD_BOT_TOKEN not set — Discord bot disabled (website + Favorites sync still work).')
    }
  })
  .catch(err => { console.error('Database init failed:', err); process.exit(1) })
