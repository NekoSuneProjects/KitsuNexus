const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')

// Accounts aren't built yet (see TODO — "accounts system last"). Until then, every Device
// and Favorite attaches to a single stub User row (isStub: true) created on first boot, so
// the schema for the real accounts system is already correct — turning on real
// register/login later is just "stop using the stub", not a migration.
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: true, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: true },
  displayName: { type: DataTypes.STRING, allowNull: true },
  isStub: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 'owner' = the single account created via /setup (first-run wizard). Public registration
  // isn't enabled yet — every future self-registered account will be role 'user'.
  role: { type: DataTypes.ENUM('owner', 'user'), allowNull: false, defaultValue: 'user' },
})

module.exports = User
