// Deletes every piece of personal data tied to an account — backs both the Privacy Policy's
// self-service "right to erasure" and the staff-initiated permanent ban (routes/dashboard.js,
// routes/admin.js). Entity (the public VRChat metadata cache) is deliberately excluded: it
// holds no personal data about the account, just public info about worlds/avatars.
const { User, Device, Favorite, WorldVisit, DiscordLink, ApiKey, ShareLink, OverlayStatus, RankScore } = require('../db')

async function eraseUserData (userId) {
  const user = await User.findByPk(userId)
  if (!user) return null

  const discordLink = await DiscordLink.findOne({ where: { userId } })
  const discordId = discordLink ? discordLink.discordId : null
  const email = user.email

  await Device.destroy({ where: { userId } })
  await Favorite.destroy({ where: { userId }, force: true }) // force: real erasure, not the usual soft-delete tombstone
  await WorldVisit.destroy({ where: { userId } })
  await DiscordLink.destroy({ where: { userId } })
  await ApiKey.destroy({ where: { userId } })
  await ShareLink.destroy({ where: { createdByUserId: userId } })
  await OverlayStatus.destroy({ where: { userId } })
  await RankScore.destroy({ where: { userId } })
  await user.destroy()

  return { email, discordId }
}

module.exports = { eraseUserData }
