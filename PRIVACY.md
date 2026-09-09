# Privacy Policy

**Effective date:** 2026-09-09
**Service:** KitsuNexus server ("the Service")
**This document covers the server component only.** The KitsuNexus desktop app has its own
privacy policy, since it runs entirely on your own computer and collects nothing on its own —
see the app's `PRIVACY.md`. This document applies once you connect the app to a KitsuNexus
server (pairing a device, creating an account, or using Cloud Sync) — whether that's the
official server at `kitsunexus.nekosunevr.co.uk`, or someone else's self-hosted instance.

## 1. Who controls your data

KitsuNexus server is open-source and self-hostable — **anyone can run their own instance.**

- If you use the **official instance** at `kitsunexus.nekosunevr.co.uk`, NekoSuneVR is the data
  controller for the data described below.
- If you use **someone else's self-hosted instance**, the person or organisation running that
  instance is the data controller for your data on it — not NekoSuneVR. We have no access to,
  and receive no data from, instances we don't operate ourselves.
- If you run your **own** self-hosted instance for yourself only, you are your own data
  controller and this policy is a template you may adapt.

## 2. What the server stores

Only what's needed to run your account and the features you opt into:

- **Account** — email address, a hashed password (never the password itself), display name,
  role (owner/user), and, if you use SSO, the identity your SSO provider gives us (issuer +
  subject id — never your SSO password).
- **Paired devices** — a name you give the device and a hashed device token. The plaintext
  token exists only in your desktop app; the server only ever stores its hash, the same way
  your password is hashed.
- **Favorites** (if you enable Cloud Sync) — VRChat world/avatar/friend ids, display names,
  images, and any notes you write, plus which collection you filed them under.
- **World-visit history** (if you enable history sync) — world id, name, and the time you
  visited, pulled from your app's local play history.
- **Public VRChat metadata cache** — names/images/descriptions/authors for worlds and avatars
  your app has shown you, so this information survives something going private or being
  deleted. This is VRChat's own public data about worlds/avatars, not personal data about you.
- **Share links** — if you create one, the world/avatar it points to and when it expires.
  Nothing about your account is exposed through a share link.
- **Overlay status** — a short-lived "now playing" snapshot for your OBS overlay URL, replaced
  every few seconds and treated as stale after 30 seconds. Not retained as history.
- **Discord link** (if you connect Discord) — your Discord user id, used to sync roles/status;
  not your Discord password (we never see it).
- **API keys** (owner-only) — a hashed key, the same way device tokens and passwords are hashed.

We do not collect analytics, advertising identifiers, or anything beyond what's listed above.

## 3. Why we process it

To provide the account, pairing, sync, sharing, and overlay features you choose to use — this
is processing necessary to perform the service you've asked for (a contract-basis, not
advertising or profiling). Nothing here is sold, shared with advertisers, or used to build a
profile of you beyond what's needed to run the features above.

## 4. Your rights (UK GDPR)

If the data controller (§1) is subject to UK GDPR, you have the right to:

- **Access** — ask what personal data we hold about you.
- **Rectification** — ask us to correct inaccurate data (e.g. a wrong display name).
- **Erasure** ("right to be forgotten") — ask us to delete your account and the personal data
  listed in §2 associated with it.
- **Restriction / objection** — ask us to stop processing your data in certain circumstances.
- **Portability** — ask for a copy of your data in a portable format.

To exercise any of these on the official instance, contact NekoSuneVR via the project's
official channels or open an issue at
<https://github.com/NekoSuneProjects/KitsuNexus/issues>. We aim to respond within one month, as
required by law. On a self-hosted instance, contact that instance's operator instead (§1) — we
cannot act on data we don't hold.

### Scope of these rights — what they are, and aren't, for

These rights exist to let you control **your own** personal data. They do not extend to:

- Demanding action, judgement, or a ruling on a dispute, moderation decision, or anything else
  that isn't the handling of your own personal data.
- Directing whether **someone else's** data is included, excluded, retained, or deleted — that
  isn't your data to decide, and a request framed that way isn't a data-subject request under
  this policy.
- Harassing, threatening, or abusing staff or other users — whether through the request process
  itself, or otherwise. A request submitted that way may be refused, and harassment of staff or
  members is treated the same as any other breach of the Terms of Service: it can result in a
  **permanent ban and immediate erasure of your account and data** (§5), not just a refusal.
  None of this affects your underlying legal rights, which you remain free to exercise through
  the proper channel (including the UK Information Commissioner's Office, ico.org.uk, if you
  believe a legitimate request was mishandled).

## 5. How long we keep it

For as long as your account exists, plus a short period afterwards for backups. Overlay status
(§2) is short-lived by design and not kept as history. Deleting your account — whether you do
it yourself, or it happens as part of a permanent ban for breaching these terms — removes the
account and the data listed in §2 tied to it, other than what we're required to retain by law
or need to retain to resolve an active dispute or enforce these terms. A permanent ban also
retains just enough identifying information (your email and/or linked Discord id, plus the
reason) to prevent re-registration under the same identity — this small record is not personal
data processed for the purposes of §2/§3, it exists solely to enforce the ban itself.

## 6. Security

Passwords, device tokens, and API keys are stored hashed, never in plaintext. Device tokens
authenticate a specific paired device to your account only — revoking a device immediately
invalidates its token.

## 7. Children

The Service is not directed at children under the age required by VRChat's own terms.

## 8. Changes

We may update this policy; the "Effective date" above will change accordingly. For the
official instance, material changes will be announced through the project's official channels.

## 9. Contact

For privacy questions about the official instance, contact NekoSuneVR via the project's
official channels, or open an issue at
<https://github.com/NekoSuneProjects/KitsuNexus/issues>.
