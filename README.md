# NekoSuneAPPS Discord backend

Small backend that holds the two secrets the Electron app (`NODEJS/`) can never hold itself —
the shared bot's token and the Discord app's OAuth client secret — and exposes an authenticated
HTTP API on top of them. It serves two features:

1. **Official shared Discord bot** — lets ordinary users read (and, if logged in, control)
   their own voice state via the app's built-in bot instead of creating their own bot/token.
2. **Discord Activity** — a live, read-only VRChat status panel that runs as an embedded iframe
   inside a Discord voice channel (`public/activity/`).

This is a fully separate service from the Electron app — its own repo branch
(`feature/discord-backend-server`, never merged into `main`), its own `package.json`/
`node_modules`, deployed independently via Docker. It is never bundled into NekoSuneAPPS
installers.

The official deployment lives at `https://nekosuneappsvrc.nekosunevr.co.uk` — that's the default
the Electron app uses (`DEFAULT_NEKOSUNE_BACKEND_URL` in `main.js`). Self-hosters can run their
own copy of this service and point the Electron app at it instead via the "Backend URL" field on
the Voice Bot card — see the `DISCORD_CLIENT_ID` row below for what else that entails.

## Env vars (`.env`, see `.env.example`)

| Var | Purpose |
|---|---|
| `DISCORD_CLIENT_ID` | The official deployment uses the same app as the locked Rich Presence ID (`1534167604304937142`), since Activities are configured per-application. Self-hosters: use your own Discord application instead — nothing requires matching the official one — but also update `CLIENT_ID` in `public/activity/app.js` to match if you use the Activity. |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 tab, for whichever application ID you used above. Never put this in the Electron app. |
| `DISCORD_BOT_TOKEN` | The shared/official bot's token. Never put this in the Electron app. |
| `DISCORD_REDIRECT_URI` | Must exactly match a redirect registered in the Portal's OAuth2 tab. The official deployment uses `https://nekosuneappsvrc.nekosunevr.co.uk/oauth2/discord/callback`. |
| `JWT_SECRET` | Signs this backend's own session tokens — `openssl rand -hex 32` |
| `JWT_TTL` | Session token lifetime (default `12h`) |
| `PORT` | Default `8080` |

## Deploy

```sh
cp .env.example .env   # fill in real values
npm install             # generates package-lock.json the first time
docker compose up -d --build
```

TLS termination is left to whatever reverse proxy already fronts your other nekosunevr.co.uk
services — this container serves plain HTTP on `PORT`, put it behind that proxy rather than
exposing it directly.

### Prebuilt image (GitHub Actions)

`.github/workflows/docker.yml` builds and pushes this image to GitHub Container Registry on
every push to `feature/discord-backend-server` (and via manual "Run workflow"), tagged both
`latest` and with the commit SHA — no extra secrets needed, it uses the repo's built-in
`GITHUB_TOKEN`. Pull it instead of building locally:

```sh
docker pull ghcr.io/nekosuneprojects/nekosuneapps/discord-backend:latest
```

The `ghcr.io/nekosuneprojects/nekosuneapps` package may need to be set to Public once (or your
deploy host given read access) under the package's own Settings on GitHub — new GitHub Container
Registry packages default to private.

## One-time manual setup (Discord Developer Portal, app `1534167604304937142`)

- **OAuth2 → Redirects**: add `https://nekosuneappsvrc.nekosunevr.co.uk/oauth2/discord/callback`
  (or your own domain, for self-hosted deployments).
- **Activities → URL Mappings → Root Mapping**: prefix `/` → target your chosen host.
  Serving the API and the Activity's static assets from this same backend means one Root
  Mapping covers both; no separate Proxy Path Mapping is needed as long as the iframe's own
  fetches stay same-origin-relative.
- Confirm **Activities** is enabled for this application before testing the iframe — it can't
  be tested locally or without this.
- Invite the shared bot (`DISCORD_BOT_TOKEN`'s user) to whichever guilds should support the
  official-bot mode or the Activity.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/oauth2/discord/authorize` | none | Redirects to Discord's authorize URL (Electron login) |
| GET | `/oauth2/discord/callback` | none (CSRF state-checked) | Code→token exchange, redirects to Electron's `localhost:3737` loopback with a session JWT |
| POST | `/api/activity/token` | none | Code→token exchange for the Activity iframe's Embedded App SDK flow |
| POST | `/api/status` | Bearer session JWT | Electron pushes its own live VRChat status |
| GET | `/api/channel/:channelId/status` | Bearer session JWT | Activity iframe reads the channel's roster + statuses |
| GET | `/api/bot/voice/:userId` | Bearer session JWT, self only | Official-bot mode reads your own voice state |
| POST | `/api/bot/voice/:userId/mute` \| `/deaf` | Bearer session JWT, self only | Official-bot mode server-mute/deafen control |
| GET | `/healthz` | none | Liveness check |

Session JWTs only prove Discord identity (`identify` scope) — they are never the bot token, and
`:userId` routes reject any session whose ID doesn't match the URL, so one user's session can
never query or control another user.

## Known limitations

- Session JWTs are stateless — revoking local storage doesn't invalidate an already-issued token
  before its `JWT_TTL` expires. Keep the TTL short.
- If the same user is connected to voice in two different guilds the bot is in, the first match
  wins (same ambiguity as the Electron app's existing bring-your-own-bot mode).
- `statusStore` and the bot gateway's caches are in-memory only — a restart clears them; clients
  simply repopulate on their next push/interval tick.
