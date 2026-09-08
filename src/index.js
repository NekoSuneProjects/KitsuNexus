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
const currentUser = require('./middleware/currentUser')
const asyncHandler = require('./utils/asyncHandler')

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
app.use(dashboardRoutes)
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
  })
  .catch(err => { console.error('Database init failed:', err); process.exit(1) })
