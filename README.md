# kitsunexus-server

The KitsuNexus website + backend: accounts, device pairing, cloud-synced Favorites, and the
KitsuNexus Discord bot — all in one self-hostable Node service. Sibling project to
[`NODEJS/`](../NODEJS) (the Electron desktop app) and the original [`server/`](../server)
Discord backend, which this project absorbs. Intended production domain:
`https://kitsunexus.nekosunevr.co.uk`.

## Status

- ✅ Homepage
- ✅ Owner account + first-run setup wizard (`/setup`, locks itself once an owner exists)
- ✅ Login/logout (`/login`, `/logout`), session cookie (JWT, httpOnly)
- ✅ **Public registration** (`/register`) — creates role `user` accounts once an Owner exists
- ✅ **ZITADEL SSO** (`/auth/zitadel/login`) — optional, offered *alongside* email/password on
  setup/login/register, not a replacement. Authorization Code + PKCE, ID token verified against
  the live JWKS (`jose`), account resolved by the stable `(issuer, sub)` pair (never by email
  alone). First SSO login becomes Owner if no owner exists yet; every account after that is
  role `user`. Every ZITADEL detail (`ZITADEL_ENDPOINT`, client id/secret, redirect URI, scopes)
  is env-configured — see `.env.example`.
- ✅ Polished shared "auth card" layout for `/login`, `/register`, `/setup`, `/pair`, `403`, `404`
- ✅ Personal dashboard (`/dashboard`) — any logged-in account's own paired devices (with
  revoke), Favorites stats by type/collection, Discord link status
- ✅ Admin dashboard (`/admin`, owner/admin roles only, 403 for everyone else) — every
  account, aggregate totals, server stats, Discord bot health
- ✅ Device-code pairing (`/pair`, requires login), `POST /api/pairing/start`,
  `GET /api/pairing/poll/:deviceId`
- ✅ Favorites sync API (`POST`/`GET /api/favorites/sync`, delta sync + tombstoned deletes)
- ✅ **World-visit history sync** (`POST`/`GET /api/history/worlds/sync`) — a separate opt-in
  from Favorites sync in the app's Settings; append-only (no tombstones needed), deduped by
  `(userId, worldId, visitedAt)`
- ✅ **Owner API — worlds feed** (`GET /api/worlds/feed`) — API-key gated (generate/revoke at
  `/admin` ▸ API keys), returns JSON of worlds you've favorited/visited for an external service
  you control to consume (e.g. an avatar/world search site). Not a public API, and not tied to
  the website login session — just its own bearer key.
- ✅ **Discord bot** — merged in from `NekoSuneAPPS/server` (`src/discord/`): the shared bot
  gateway, guild whitelist, live status store, and the Activity iframe (`public/activity/`).
  Optional — leave the `DISCORD_*` env vars blank and the site runs fine without it.
  `/settings/discord` links a Discord identity to your website account (separate from the
  Electron app's own narrower Discord bearer-token flow, which is unchanged and still works).
- ✅ **Desktop update/config endpoints** — `GET /api/desktop/updates/latest` caches the
  official GitHub release metadata for desktop update checks; `GET /api/desktop/config`
  supplies the default Discord Rich Presence Application ID. Both are public and require
  no paired account. Override `DISCORD_RICH_PRESENCE_APP_ID` to configure that desktop ID
  independently of `DISCORD_CLIENT_ID` (used for the server's OAuth/bot).
- ✅ Docker (`Dockerfile` + `docker-compose.yml`) + manual CI
  (`.github/workflows/docker.yml`). Under **Actions -> Build KitsuNexus Server
  Docker -> Run workflow**, choose **GitHub-hosted** (`ubuntu-24.04`) or **self-hosted**
  (`Linux`, `docker`, `buildx` runner labels). Both build `linux/amd64` and `linux/arm64`
  from the `server` branch. Enable **Publish image** only when you want to upload the
  `latest` and `sha-<server commit>` tags to GHCR. A build-only run stores neither
  a registry image nor a GitHub Actions build cache.
- ❌ Avatar-switch relay (WebSocket) — not started

See the KitsuNexus repo's `TODO.md` ("☁️ Cloud backend" section) for the full plan.

## Run it

```
npm install
cp .env.example .env   # set JWT_SECRET for anything beyond local testing
npm start
```

Or with Docker:

```
cp .env.example .env
docker compose up -d
```

Then open http://localhost:8081/setup to create the Owner account (first visit only — it
redirects to `/login` after that). Pair a KitsuNexus desktop install via Settings ▸ ☁ Cloud
Sync in the app: enter your server URL, then enter the code shown at `/pair` while logged in.

Discord bot integration is optional — fill in `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/
`DISCORD_BOT_TOKEN`/`DISCORD_REDIRECT_URI` in `.env` to enable it, then link your account at
`/settings/discord`.

### Community Booster rewards

The server owns the **Community Booster** catalogue and entitlement checks.
Once a user pairs the Electron desktop through Cloud Sync and links their
Discord account at `/settings/discord`, the server checks whether that Discord
account actively boosts any configured booster guild. The personal dashboard has a
**Community Booster** panel showing the current verified tier and available
cosmetics. Core desktop features remain free without boosting.

- `GET /api/community-booster/catalog` is public and returns the tier catalogue
  and recommended default appearance settings.
- `GET /api/community-booster/me` requires the existing paired-device bearer
  token and returns the user's **server-verified** booster tier, unlocked
  cosmetics, verified active-boost indicator and reward level. Missing/revoked
  credentials are rejected; Discord outages return HTTP 503.
- Configure `DISCORD_BOOST_GUILD_IDS=1539604439625764894,1274732053337870417`
  for the two supported booster servers, along with `DISCORD_BOT_TOKEN` and
  Discord OAuth credentials. The bot must be present in **both** guilds and
  have Server Members Intent enabled. Missing guilds or failed member lookups
  produce HTTP 503, preserving the desktop's short-lived cached rewards.
  Without `DISCORD_BOOST_GUILD_IDS`, verification uses `DISCORD_OFFICIAL_GUILD_ID`.
  The official guild still controls moderation and Community Rank role sync;
  booster guilds are only used for entitlement checks.
- A boost in either guild grants Spark; boosting both guilds earns reward level
  2 (Glow). This counts boosting **guilds**, not the number of individual slots
  used in any one guild.
- Optional `DISCORD_BOOST_TIER_ROLES` maps reward levels to role IDs, e.g.
  `{"2":"ROLE_ID","3":"ROLE_ID","5":"ROLE_ID"}`. The Discord member API
  confirms active boosting but does **not** reliably expose the number of
  boosts each user contributes within a guild; trusted roles upgrade *active*
  boosters to Glow, Nova and Constellation. The legacy role map applies only to
  the official guild. `DISCORD_BOOST_TIER_ROLES_BY_GUILD` can supply separate
  threshold-to-role mappings for each boost guild.
- Desktop appearance preferences default to enabled for unlocked cosmetic
  effects, including ribbons, sparkles, accents, borders, ambient lighting,
  gradients, navigation highlights, frames and starlight. Highest unlocked
  decoration is selected automatically. The desktop checks every minute and
  caches verified rewards for no more than five minutes; revoked pairings,
  expired cache and confirmed ended boosts remove unlocked effects.

See [`NODEJS/docs/community-booster.md`](../NODEJS/docs/community-booster.md)
for the full desktop and API integration guide.

Twitch OAuth2 is optional. Register a Twitch **Confidential** application with
`<SITE_URL>/oauth2/twitch/callback` as its redirect, then configure
`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and a stable, randomly generated
`TWITCH_TOKEN_KEY` in `.env`. Sign in to the KitsuNexus dashboard and link Twitch
in its Twitch panel. Paired desktop apps fetch renewable Twitch access through
`GET /api/twitch/credentials` using their device bearer token. The server keeps
refresh tokens encrypted at rest and never sends them to a desktop device. The
desktop keeps issued access tokens in the Electron main process memory, syncs
the account at startup and every minute, and stops active connections when
the link disappears. Unlinking removes stored credentials before attempting
token revocation, so a new authorization created during revocation is preserved.
The dashboard's Twitch unlink form uses a session-bound CSRF token, and a pending
token refresh cannot overwrite credentials from a newer authorization.
Keep both `TWITCH_TOKEN_KEY` and `JWT_SECRET` stable across restarts and backend
instances (changing either breaks stored tokens or authorization sessions).
The Twitch Client ID, secret and redirect URI must belong to the same Twitch
application. Authorize through the server dashboard while signed in to the
website; the desktop's Twitch OAuth Accounts panel opens this authorization
page when paired. The OAuth flow still needs live verification after deployment.
