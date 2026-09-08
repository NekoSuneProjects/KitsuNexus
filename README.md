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
- ✅ Personal dashboard (`/dashboard`) — any logged-in account's own paired devices (with
  revoke), Favorites stats by type/collection, Discord link status
- ✅ Admin dashboard (`/admin`, owner/admin roles only, 403 for everyone else) — every
  account, aggregate totals, server stats, Discord bot health
- ✅ Device-code pairing (`/pair`, requires login), `POST /api/pairing/start`,
  `GET /api/pairing/poll/:deviceId`
- ✅ Favorites sync API (`POST`/`GET /api/favorites/sync`, delta sync + tombstoned deletes)
- ✅ **Discord bot** — merged in from `NekoSuneAPPS/server` (`src/discord/`): the shared bot
  gateway, guild whitelist, live status store, and the Activity iframe (`public/activity/`).
  Optional — leave the `DISCORD_*` env vars blank and the site runs fine without it.
  `/settings/discord` links a Discord identity to your website account (separate from the
  Electron app's own narrower Discord bearer-token flow, which is unchanged and still works).
- ✅ Docker (`Dockerfile` + `docker-compose.yml`) + CI (`.github/workflows/docker.yml`,
  multi-arch `linux/amd64,linux/arm64` build on the shared self-hosted runner, same pattern as
  `NODEJS`'s Electron build)
- ⏳ **Public registration** — deliberately not built yet, by request. Only the one Owner
  account exists for now (created via `/setup`); every future self-registered account will be
  role `user`, added when asked for.
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
