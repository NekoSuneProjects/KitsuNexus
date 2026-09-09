const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')
const User = require('./User')

// Cloud-synced mirror of the Electron app's local_favorites table
// (modules/favorites/localFavoritesDb.js). Deletes are soft (paranoid: true → deletedAt) so a
// delta sync can tell other devices "this one was removed" instead of just disappearing.
const Favorite = sequelize.define('Favorite', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  // 'group' added after this table already existed in deployed databases. No migration needed
  // for that: unlike some other dialects, this Sequelize version's SQLite backend never emits a
  // CHECK constraint for ENUM columns (verified — the generated column is plain `TEXT NOT
  // NULL`), so ENUM membership is enforced only in JS at the model layer. Widening the list here
  // is the entire change; existing rows and the raw column are untouched.
  type: { type: DataTypes.ENUM('friend', 'world', 'avatar', 'group'), allowNull: false },
  vrchatId: { type: DataTypes.STRING, allowNull: false },
  displayName: { type: DataTypes.STRING, allowNull: true },
  imageUrl: { type: DataTypes.STRING, allowNull: true },
  note: { type: DataTypes.TEXT, allowNull: true },
  collection: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
}, {
  paranoid: true,
  indexes: [{ unique: true, fields: ['userId', 'type', 'vrchatId'] }],
})

Favorite.belongsTo(User, { foreignKey: 'userId' })

module.exports = Favorite
