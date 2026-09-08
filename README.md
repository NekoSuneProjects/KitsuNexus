# kitsunexus-server

The KitsuNexus website + backend: accounts, device pairing, cloud-synced Favorites, and
(eventually) the NekoSuneAPPS Discord bot merged in — all in one self-hostable Node service.
Sibling project to [`NODEJS/`](../NODEJS) (the Electron desktop app) and the current
[`server/`](../server) Discord backend, which this project will absorb.

## Status

- ✅ Homepage
- ✅ Device-code pairing (`/pair`, `POST /api/pairing/start`, `GET /api/pairing/poll/:deviceId`)
- ✅ Favorites sync API (`POST`/`GET /api/favorites/sync`, delta sync + tombstoned deletes)
- ❌ Accounts (register/login) — **deliberately last**. Every Device/Favorite currently attaches
  to a single stub `User` row (`isStub: true`); `/pair` has no login wall yet, so anyone who can
  reach this server can claim a pending pairing code. Don't expose this publicly until accounts
  land — self-host it behind your own network/VPN for now.
- ❌ Avatar-switch relay (WebSocket) — not started
- ❌ Discord bot merge (from `NekoSuneAPPS/server`) — not started

See the KitsuNexus repo's `TODO.md` ("☁️ Cloud backend" section) for the full plan.

## Run it

```
npm install
cp .env.example .env
npm start
```

Then open http://localhost:8081. Pair a KitsuNexus desktop install via Settings ▸ ☁ Cloud Sync,
enter your server URL, then enter the code shown at `http://localhost:8081/pair`.
