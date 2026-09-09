const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')

// A cached snapshot of public VRChat metadata for a world/avatar/user, keyed by VRChat's own id
// (not a KitsuNexus account id). Populated by paired devices as they browse VRChat's API — see
// routes/entityCache.js — independent of any one user's Favorites/history, so this info
// survives even after the real thing goes private or gets deleted, and so Share links
// (routes/share.js) have something public-safe to show without ever touching a user's own
// account data.
const Entity = sequelize.define('Entity', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type: { type: DataTypes.ENUM('world', 'avatar', 'user'), allowNull: false },
  vrchatId: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: true },
  imageUrl: { type: DataTypes.STRING, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  authorName: { type: DataTypes.STRING, allowNull: true },
  authorId: { type: DataTypes.STRING, allowNull: true },
  // JSON-encoded free-form fields — tags, capacity, platform, releaseStatus, etc. Worlds,
  // avatars and users each carry different extra fields, so this stays a blob rather than a
  // fixed set of columns.
  tags: { type: DataTypes.TEXT, allowNull: true },
  extra: { type: DataTypes.TEXT, allowNull: true },
  // 'public' = last confirmed visible/fetchable; 'private' = fetch succeeded but VRChat reports
  // it access-restricted; 'deleted' = VRChat returned 404 (gone, not just hidden); 'unknown' =
  // cached before we ever tracked visibility, or not checked since.
  visibility: { type: DataTypes.ENUM('public', 'private', 'deleted', 'unknown'), allowNull: false, defaultValue: 'unknown' },
  lastSeenPublicAt: { type: DataTypes.DATE, allowNull: true },
  // First time we observed this go private/deleted — kept even if it later reappears public, as
  // a "this has gone away before" signal; only cleared implicitly by not being touched.
  goneAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [{ unique: true, fields: ['type', 'vrchatId'] }],
})

module.exports = Entity
