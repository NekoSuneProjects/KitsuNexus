const express = require('express')

const router = express.Router()

router.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms of Service — KitsuNexus' })
})

router.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'Privacy Policy — KitsuNexus' })
})

module.exports = router
