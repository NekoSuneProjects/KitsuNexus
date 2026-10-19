# KitsuNexus Community Booster / LinkUp contract (proposed)

This is an **integration contract to implement on LinkUp**. The public
`GET /api/supporters` feed and existing Discord Voice Bot / Rich Presence
connections cannot authenticate a KitsuNexus user or attest a boost. Until
the endpoints below exist, the app displays the normal base theme and a clear
connection error. Never enable a tier using a typed Discord ID or a setting.

All requests originate in the Electron **main process** over TLS to the fixed
origin `https://linkup.nekosunevr.co.uk`. No inbound localhost callback server
or WebSocket is needed. LinkUp must require a first-party signed-in browser
session for the authorization confirmation page, with explicit user consent.

1. `POST /api/v1/kitsunexus/device/authorize`: receive
   `{client_id:"kitsunexus-desktop", scope:"boostRewards.read", state,
   code_challenge, code_challenge_method:"S256"}`. Store a cryptographically
   random device grant, SHA-256 PKCE challenge and opaque client state, bound
   to the **LinkUp account authenticated in the browser only after consent**.
   Respond with `{device_code, user_code, verification_uri, state,
   expires_in, interval}`. `verification_uri` must use the LinkUp origin.
   Device codes expire in 30–1800 seconds; enforce a minimum polling interval.
2. `POST /api/v1/kitsunexus/device/token`: receive `{client_id,
   device_code, code_verifier, state}`. Verify state, single-use code, expiry,
   PKCE S256, polling interval, browser authorization and account binding.
   While pending, return HTTP 400 `{error:"authorization_pending"}`;
   optionally `{error:"slow_down"}`, `{error:"access_denied"}` or
   `{error:"expired_token"}`. On success return `{access_token, token_type:
   "Bearer", scope:"boostRewards.read", expires_in, subject, state}`.
   Limit access tokens to the one account and scope, max 24-hour lifetime.
   All token and subject claims must come from LinkUp server records.
3. `GET /api/v1/kitsunexus/me/boost-rewards`: require the Bearer token,
   check scope and retrieve LinkUp's server-verified Discord/booster binding.
   Respond with `{subject, boostRewards:{verified:true, activeBoostCount,
   endsAt}}`, where `endsAt` may be null when unknown. `subject` must be the
   same stable account identifier as the token's `subject`; the count must be
   the verified **current** boost count, not a claimed Discord ID or
   role supplied by the desktop. Return 401/403 for revoked tokens or links.
   Return `activeBoostCount:0` when boosts finish.
4. `POST /api/v1/kitsunexus/device/revoke`: accept the scoped Bearer
   token and `{client_id:"kitsunexus-desktop"}`. Revoke the session promptly;
   the desktop removes its credentials first even when offline.

Responses must be JSON. Use `Cache-Control: no-store` for grant/token responses.
The client requests **only** the subject and `boostRewards` fields. It checks
all types, requires server-side `verified:true`, checks the token subject,
limits reward caching to five minutes and never uses expired claims on restart.
An unexpired cache may display briefly while offline, then returns to the base
theme. Zero boosts and revoked/expired grants remove the cosmetics immediately
after they are confirmed. Cosmetic preferences persist separately.

The app stores access tokens in an Electron `safeStorage`-encrypted local file
and does not put them in renderer IPC, generic settings, analytics, logs, OSC,
chatbox or overlay payloads. On Linux with an insecure `basic_text` backend
or other platforms without safeStorage encryption, grants stay in memory and
must be reauthorized after restart. The renderer currently requires Node.js
for existing OSC/audio modules; **full context isolation remains outstanding**.
This legacy boundary means there is still an injection risk elsewhere in the
application, despite the separate LinkUp credential handling. Migrate the
renderer modules to privileged IPC and enable `contextIsolation:true` and
`nodeIntegration:false` before treating the entire app as isolated.

The cosmetics do not change Discord Rich Presence, VRChat statuses, voice bot,
OSC, accessibility or account features. Publishing supporter labels outside
the local desktop would require a separate explicit opt-in flow.
