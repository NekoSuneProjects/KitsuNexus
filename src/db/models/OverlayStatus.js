const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// The latest "now playing" snapshot a paired device has pushed for a user (routes/overlay.js) —
// one row per user, last-write-wins across however many devices that user has paired. Backs the
// public /overlay/:overlayId OBS Browser Source page: it's what turns "the app pushes music
// stuff" into something a public URL can poll, without the overlay page itself ever touching a
// user's account or device token.
const OverlayStatus = sequelize.define('OverlayStatus', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, unique: true },
  // JSON-encoded — whatever shape the app's now-playing provider produces (title/artist/album/
  // image/status/progressMs/durationMs/source/...). Kept opaque here; routes/overlay.js is the
  // only thing that needs to know its shape, same as the old local overlay server did.
  payload: { type: DataTypes.TEXT, allowNull: false },
})

OverlayStatus.belongsTo(User, { foreignKey: 'userId' })

module.exports = OverlayStatus
