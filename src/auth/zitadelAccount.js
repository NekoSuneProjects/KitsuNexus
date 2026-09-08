// Resolves a verified ZITADEL identity (ID token payload) to a local User row. Keyed by the
// stable (issuer, sub) pair — never by email alone, since email can be unverified or reused.
const { User } = require('../db')

async function resolveUser (payload) {
  const existing = await User.findOne({ where: { oidcIssuer: payload.iss, oidcSub: payload.sub } })
  if (existing) return existing

  // Link to an existing email/password account (e.g. the Owner created via /setup) only when
  // ZITADEL itself has verified that email — otherwise a same-named-but-different person could
  // hijack someone else's account just by typing their email into a profile field.
  if (payload.email && payload.email_verified) {
    const byEmail = await User.findOne({ where: { email: String(payload.email).trim().toLowerCase(), oidcSub: null } })
    if (byEmail) {
      byEmail.oidcIssuer = payload.iss
      byEmail.oidcSub = payload.sub
      await byEmail.save()
      return byEmail
    }
  }

  const ownerExists = !!(await User.findOne({ where: { role: 'owner' } }))
  return User.create({
    oidcIssuer: payload.iss,
    oidcSub: payload.sub,
    email: (payload.email_verified && payload.email) ? String(payload.email).trim().toLowerCase() : null,
    displayName: payload.name || payload.preferred_username || (payload.email ? payload.email.split('@')[0] : 'SSO user'),
    role: ownerExists ? 'user' : 'owner', // first ZITADEL login becomes Owner if nobody has claimed it yet
    isStub: false,
  })
}

module.exports = { resolveUser }
