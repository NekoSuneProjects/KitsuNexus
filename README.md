# KitsuNexus Discord backend

Small backend that holds the two secrets the Electron app (`NODEJS/`) can never hold itself —
the shared bot's token and the Discord app's OAuth client secret — and exposes an authenticated
HTTP API on top of them. It serves two features:

1. **Official shared Discord bot** — lets ordinary users read (and, if logged in, control)
   their own voice state via the app's built-in bot instead of creating their own bot/token.
   The bot auto-detects whichever voice channel a user is currently in by scanning the guilds
   it's a member of; if that user isn't in a voice channel in any guild the bot can see (e.g.
   they're not in a shared server with the bot at all), voice state just comes back empty and
   the app correctly shows "not in voice" rather than stale/wrong data.
2. **Discord Activity** — a live, read-only VRChat status panel that runs as an embedded iframe
   inside a Discord voice channel (`public/activity/`).

This is a fully separate service from the Electron app — its own repo branch
(`feature/discord-backend-server`, never merged into `main`), its own `package.json`/
`node_modules`, deployed independently via Docker. It is never bundled into KitsuNexus
installers.

The official deployment lives at `https://kitsunexus.nekosunevr.co.uk` — that's the default
the Electron app uses (`DEFAULT_NEKOSUNE_BACKEND_URL` in `main.js`). Self-hosters can run their
own copy of this service and point the Electron app at it instead via the "Backend URL" field on
the Voice Bot card — see the `DISCORD_CLIENT_ID` row below for what else that entails.

## Env vars (`.env`, see `.env.example`)

| Var | Purpose |
|---|---|
| `DISCORD_CLIENT_ID` | The official deployment uses the same app as the locked Rich Presence ID (`1534208250046578790`), since Activities are configured per-application. Self-hosters: use your own Discord application instead — nothing requires matching the official one — but also update `CLIENT_ID` in `public/activity/app.js` to match if you use the Activity. |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 tab, for whichever application ID you used above. Never put this in the Electron app. |
| `DISCORD_BOT_TOKEN` | The shared/official bot's token. Never put this in the Electron app. |
| `DISCORD_REDIRECT_URI` | Must exactly match a redirect registered in the Portal's OAuth2 tab. The official deployment uses `https://kitsunexus.nekosunevr.co.uk/oauth2/discord/callback`. |
| `JWT_SECRET` | Signs this backend's own session tokens — `openssl rand -hex 32` |
| `JWT_TTL` | Session token lifetime (default `12h`) |
| `PORT` | Default `8080` |
| `DISCORD_INVITE_URL` | Optional. `GET /` redirects here (e.g. your Discord server's invite) — left blank, `/` just serves a plain placeholder page. |

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
docker pull ghcr.io/nekosuneprojects/kitsunexus/discord-backend:latest
```

The `ghcr.io/nekosuneprojects/kitsunexus` package may need to be set to Public once (or your
deploy host given read access) under the package's own Settings on GitHub — new GitHub Container
Registry packages default to private.

## One-time manual setup (Discord Developer Portal, app `1534208250046578790`)

- **Bot tab**: add a bot user if one doesn't exist yet and generate its token — that's
  `DISCORD_BOT_TOKEN`. A plain OAuth2 application isn't enough; `discordBotGateway.js` needs a
  real bot user to log into the gateway.
- **Bot tab → Privileged Gateway Intents**: enable **Server Members Intent**. The code requests
  `GatewayIntentBits.GuildMembers`; Discord rejects the gateway connection without this toggle on.
- **Installation → Installation Contexts**: keep **Guild Install** checked (required to add the
  bot to any server at all). **User Install** isn't used by anything here — leave it checked or
  not, it makes no difference.
- **OAuth2 → Redirects**: add `https://kitsunexus.nekosunevr.co.uk/oauth2/discord/callback`
  (or your own domain, for self-hosted deployments).
- **Activities → URL Mappings → Root Mapping**: prefix `/` → target your chosen host.
  Serving the API and the Activity's static assets from this same backend means one Root
  Mapping covers both; no separate Proxy Path Mapping is needed as long as the iframe's own
  fetches stay same-origin-relative.
- Confirm **Activities** is enabled for this application before testing the iframe — it can't
  be tested locally or without this.
- Don't hand out a plain Discord "Add to Server" bot-invite link — share `https://<your-host>/dashboard`
  instead. See "Bot whitelist" below for why.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | none | Redirects to `DISCORD_INVITE_URL` if set, else a plain placeholder page |
| GET | `/robots.txt` | none | Disallows all crawling |
| GET | `/dashboard` | browser session cookie | Web dashboard — log in, see which servers you've authorized, add the bot to another one, remove it from ones you currently manage |
| GET | `/dashboard/logout` | none | Clears the dashboard session cookie |
| POST | `/dashboard/revoke/:guildId` | browser session cookie + live Manage Server check | Un-authorizes a guild and makes the bot leave it immediately |
| GET | `/oauth2/discord/authorize` | none | Redirects to Discord's authorize URL — plain `identify` login, used ONLY by Electron's "Log in with Discord" (ends at its `localhost:3737` loopback, not the dashboard) |
| GET | `/oauth2/discord/authorize-dashboard` | none | Same plain `identify` login, but for the web dashboard (ends with a session cookie + redirect to `/dashboard`) |
| GET | `/oauth2/discord/authorize-bot` | none | Combined `identify bot` scope — the ONLY path that can add the bot to a guild and have it stick (see Bot whitelist below). Always ends at the dashboard, never Electron's loopback. |
| GET | `/oauth2/discord/callback` | none (CSRF state-checked) | Code→token exchange for all three flows above. Sends Electron logins to its `localhost:3737` loopback with a session JWT; sends dashboard/bot logins to a session cookie + `/dashboard`. If `guild_id` is present (came from the `-bot` flow), authorizes that guild. |
| POST | `/api/activity/token` | none | Code→token exchange for the Activity iframe's Embedded App SDK flow |
| POST | `/api/status` | Bearer session JWT | Electron pushes its own live VRChat status |
| GET | `/api/channel/:channelId/status` | Bearer session JWT | Activity iframe reads the channel's roster + statuses |
| GET | `/api/bot/voice/:userId` | Bearer session JWT, self only | Official-bot mode reads your own voice state |
| POST | `/api/bot/voice/:userId/mute` \| `/deaf` | Bearer session JWT, self only | Official-bot mode server-mute/deafen control |
| GET | `/healthz` | none | Liveness check |

Session JWTs only prove Discord identity (`identify` scope) — they are never the bot token, and
`:userId` routes reject any session whose ID doesn't match the URL, so one user's session can
never query or control another user.

## Bot whitelist — no random server can keep the bot

Adding the bot to a guild through Discord's normal "Add to Server" link (the plain `bot` scope,
with no cooperation from this backend) does **not** let it stay there. `src/authorizedGuilds.js`
persists a whitelist (`data/authorized-guilds.json`, mounted as a volume in `docker-compose.yml`
so it survives restarts) of guild IDs that were authorized through `/oauth2/discord/authorize-bot`
— the only flow where an authenticated Discord user explicitly picked that guild during Discord's
own consent screen, recorded against their Discord user ID in the callback.

`src/discordBotGateway.js` enforces this: on `GuildCreate` (the bot joining any guild, after a
15s grace window — see below) and once more at startup (sweeping every guild it's already in),
it checks the whitelist and calls `guild.leave()` on anything not on it. A leaked or
independently-generated "add bot" link still can't keep the bot around — it'll join and leave
right away.

**Grace window**: Discord adds the bot to a guild (firing `GuildCreate` over the gateway) as
part of the same consent click that redirects the browser back to `/oauth2/discord/callback`,
which is what actually records the authorization. Those two happen over independent channels
with no ordering guarantee, so `GuildCreate`'s enforcement waits 15 seconds before checking —
otherwise a guild that's about to be legitimately authorized could get kicked first.

**Removing the bot**: only someone who *currently* holds Manage Server (or Administrator, or is
the owner) in a guild can remove the bot from it via the dashboard — checked live against
Discord (`hasManagePermission`), not just "whoever originally added it," since admin rights
belong to the server, not to whoever happened to click "invite" first. Anyone without that
permission sees the guild listed read-only; the `POST /dashboard/revoke/:guildId` route
re-checks the same permission server-side regardless of what the UI shows.

## Security / privacy hardening

- `helmet()` — drops `X-Powered-By` and sets standard security headers, so less is passively
  leaked to scanners.
- `robots.txt` disallows all crawling.
- `/api/status` and the bot-control routes are rate-limited per authenticated Discord user
  (`express-rate-limit`) — this API is public-facing and fed by every install of the app, unlike
  everything else in KitsuNexus, which is local-loopback only.

## Known limitations

- Session JWTs are stateless — revoking local storage doesn't invalidate an already-issued token
  before its `JWT_TTL` expires. Keep the TTL short.
- If the same user is connected to voice in two different guilds the bot is in, the first match
  wins (same ambiguity as the Electron app's existing bring-your-own-bot mode).
- `statusStore` and the bot gateway's live voice-state cache are in-memory only — a restart clears
  them; clients simply repopulate on their next push/interval tick. Only the authorized-guilds
  whitelist is persisted to disk.
