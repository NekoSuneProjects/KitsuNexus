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
- ✅ Docker (`Dockerfile` + `docker-compose.yml`) + CI (`.github/workflows/docker.yml`,
  multi-arch `linux/amd64,linux/arm64` build on the shared self-hosted runner, same pattern as
  `NODEJS`'s Electron build)
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
