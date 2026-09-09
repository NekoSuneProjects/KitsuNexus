const { DataTypes } = require('sequelize')
const sequelize = require('../sequelize')

// A KitsuNexus account. Two ways in: email/password (routes/auth.js) or ZITADEL SSO
// (routes/zitadelAuth.js) — a user can have either, both, or (before either has run) just be
// the stub placeholder every Device/Favorite starts out attached to (isStub: true).
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: true, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: true },
  displayName: { type: DataTypes.STRING, allowNull: true },
  isStub: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 'owner' = the account that ran /setup, OR the first account ever to sign in via ZITADEL
  // if no owner exists yet. Public registration (email/password or SSO) otherwise only ever
  // creates role 'user'.
  role: { type: DataTypes.ENUM('owner', 'user'), allowNull: false, defaultValue: 'user' },
  // ZITADEL SSO identity — the stable (issuer, sub) pair from the verified ID token, per
  // routes/zitadelAuth.js. Never resolve an account by email alone for SSO (emails can be
  // unverified or reused); this pair is the only thing trusted for "is this the same person".
  oidcIssuer: { type: DataTypes.STRING, allowNull: true },
  oidcSub: { type: DataTypes.STRING, allowNull: true, unique: true },
  // Public, unguessable id for this account's OBS overlay (routes/overlay.js) — the
  // /overlay/:overlayId page and its /api/overlay/:overlayId/now-playing feed are public (no
  // login), so this doubles as the access control: whoever has the URL can view it, nobody can
  // guess it. Nullable because it can't be backfilled with a per-row random value through a
  // plain ALTER TABLE ADD COLUMN (see db/index.js's backfillOverlayIds) — every account still
  // ends up with one, just not atomically with the column's creation.
  overlayId: { type: DataTypes.STRING, allowNull: true, unique: true },
})

module.exports = User
