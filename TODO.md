# NekoSuneAPPS — TODO / Roadmap

Feature-parity checklist toward **VRCX** + **VRCNext**, our own version. Sources:
[VRCX](https://github.com/vrcx-team/VRCX), [VRCNext](https://github.com/shinyflvre/VRCNext).

Legend: `[x]` done · `[~]` partial · `[ ]` todo · ⚠️ technical blocker.

## 🚨 ALWAYS: Optimise the app (it's laggy)
- [~] **Performance pass — top priority.** App feels laggy. Investigate:
  - [x] Virtualise long lists — rail sections now capped at 150 rows (+N more note); paged tabs
  - [x] Throttle/debounce re-renders; avoid full innerHTML rebuilds on every update
  - [x] Audit all `setInterval` pollers — staggered on launch (friendDiff 8s/notif 14s/groups 22s) + 429 backoff guard on every poller
  - [~] Lazy-load tab content only when visible; pause canvas (spectrum/OSC graph) off-tab — canvas has `offsetParent` guards; full tab lazy-load still todo
  - [x] Reuse the API cache everywhere; add request backoff on 429 (interceptor + isRateLimited + stale-cache fallback)
  - [ ] Profile with DevTools; check GPU/CPU (hardware accel already off)
- [~] **Full friends scan** — paginated online+active+offline; verify none missing
- [x] **Name-change tracking** — logged in History (friend-diff)
- [x] **VRCX import** — best-effort import button (verify vs real VRCX.sqlite3)
- [~] **Perf** — friends panel/radar no longer rebuild every 3s; idle stopwatch fixed;
  tiered friend cache (offline 5min/online 90s), self cache, world poll 5s, SQLite write
  debounced 8s + events capped 8000, rightbar 120s; **paged lists** (Friend Den, My Groups,
  Mutuals, Blocked, Favs). (rail offline virtualisation still todo)

---

## ✅ Already done (for reference)
- [x] Friend list + right panel (Same World / In-Game / On Web / Offline, collapsible)
- [x] Friend Den, Event Scout (multi-group), Pawprints (per-world time)
- [x] Unified **Search** (users/worlds/groups) + **paste ID/URL** loader
- [x] **Profile modal**: Info (badges), Groups, Mutuals (friends+groups), Content, Favs
- [x] Social actions: Add Friend↔Unfriend, Invite, Request Invite, **Boop**, Favorite
- [x] World + Group **detail modals**; clickable cards everywhere
- [x] **History (SQLite)**: player join/leave, friend add/remove, world visits
- [x] **Auto-Greeter** (auto-accept friend requests, all/allow-list)
- [x] Discord Rich Presence (world + HR + song; buttons auto-drop over IPC)
- [x] **Pinned Discord Rich Presence Application ID to `1534208250046578790`**, no longer
  user-editable — disabled the Discord Application ID field in the Discord tab and force the
  fixed ID in `renderer.js` and `main.js`'s `discord:start` handler regardless of saved config.
- [~] **Discord Activity (VRChat status panel) + official shared Discord bot.** New standalone
  backend, own package.json/Docker, deployed separately — never bundled into the app — lives on
  its own branch in this same GitHub repo
  ([`feature/discord-backend-server`](https://github.com/NekoSuneProjects/NekoSuneAPPS/tree/feature/discord-backend-server)),
  not as a subfolder here. It holds the shared bot token and OAuth client secret, which can
  never live in a distributed Electron app. Backend + Electron-side code (identity login,
  official-bot mode, status push) are implemented and locally verified (curl against the
  running backend, `node --check`/require-resolution on every changed file). Defaults to the
  official `https://nekosuneappsvrc.nekosunevr.co.uk` deployment (`DEFAULT_NEKOSUNE_BACKEND_URL`
  in `main.js`), but self-hosters can override it via the Backend URL field on the Voice Bot
  card (`nekosuneBackendUrl` setting) to point at their own instance instead. **Not deployed by
  this session** — still needed before this works end to end: actually deploy that official
  host, fill in that branch's `.env` (bot token, OAuth client secret, JWT secret), register the
  OAuth redirect + Activities URL Mapping in the Developer Portal for app
  `1534208250046578790`, and get
  Activities enabled for that app. See that branch's `README.md` for the full one-time setup
  checklist.
- [x] **Fixed: Discord Rich Presence's elapsed timer reset on every status change** instead of
  showing real uptime. The code read a `startTime` property directly off `discord-rpc`'s
  `Client` object, which doesn't exist at all (confirmed against the library's own source) - so
  the timestamp anchor was always `undefined`, and Discord fell back to its own "time since last
  update" display, which recalculates on every single presence push. Now anchors to a real
  `Date.now()` taken once on connect, reused for every update after. Verified with a mocked
  Discord client: identical timestamp across multiple simulated status changes.
- [x] **Fixed: Multi-line chatbox's Now Playing line never showed progress/duration**, only the
  bare song name - even though `{songbar}`/`{songtime}` were already fully working tokens for
  Status presets. `chatboxComposer.js`'s hardcoded `nowPlaying` line just never referenced them.
  Now appends the progress bar + elapsed/duration when a source reports one, falls back to just
  the song name when it doesn't (e.g. some sources don't report duration at all).
- [x] VRChat auto-status (login + 2FA), Radar, Weather, VRChat Tools (yt-dlp/cache)
- [x] Heart rate (Pulsoid + HypeRate) + session analytics
- [x] Param Lab (OSC), Photo Relay (screenshots→Discord), Soundpad, SpotiOSC, DiscordOSC, Discord voice bot
- [x] Auto-launch / start-minimized / per-feature auto-start
- [x] Green UI, icon rail, notifications flyout, auto seasonal themes, hidden scrollbars

---

## 🔜 Next day — VRCX parity gaps

### Activity & logging
- [x] **Video/media link tracking** — video URLs parsed from the log → History
- [x] **Name-change tracking** — friend renames logged to History (name_change)
- [x] **Activity heatmap** — day×hour event heatmap on the History page
- [x] **Instance join/leave history** — enter + leave-with-duration logged to History
- [x] **GameLog** — join/leave/world (w/ duration)/friend/name-change/video/**portals**/invites/group events

### Friends & social
- [x] **VRC Notes editor** — read + write your note on a user (profile Info tab)
- [x] **Social status presets** — save/apply status + statusDescription combos (Profile Editor)
- [x] **Last-seen / time-together** — shown on the profile Info tab (from History)
- [x] **Block / mute** — toggle on profiles + a Blocked/Muted list (Settings) with Remove
- [x] **Trust/feedback view** — visual trust ladder (Visitor → New User → User → Known User → Trusted User) with current level highlighted, shown in the profile modal info tab

### Search & data
- [x] **Local quick-search** — instant offline friend search on the Search page
- [x] **Avatar search** — via the Avatars page (provider-based)
- [x] **Favorites backup** — export favorite worlds + friends to JSON; import re-adds them via the API (avatar favs not yet included — no dedicated API endpoint)
- [x] **Data export/import** — settings + history to JSON

### Media
- [ ] **Screenshot metadata** — embed world/instance/players into the PNG (VRChat picture metadata), and read it back in a gallery
- [x] **Media Library** — VRChat screenshot gallery (open on click); date/world filters todo
- [ ] **Avatar/world image upload** management (without Unity) — advanced, optional

### System
- [x] **VRChat server status** — online-user count in the top bar (poll /visits)
- [x] **Configured Start** — launch companion apps (+ optional VRChat)
- [x] **Data export/import** — settings + history to JSON
- [x] **Crash recovery / auto-rejoin** — opt-in; relaunches last instance if VRChat closes
- [x] **Fixed: auto-rejoin treated every normal VRChat close as a crash.** It only checked "is
  VRChat.exe still running", which is equally true after a real crash and after just closing the
  game normally - so it couldn't actually tell the two apart, and always assumed the worst. Now
  cross-checks Windows' own crash reporter (WER): a real crash (unhandled exception, access
  violation, etc.) always logs an "Application Error" event (Application log, Event ID 1000) for
  the crashing process, a normal quit never does. Cross-checked this against 26 real historical
  VRChat logs pulled from the user's own backup: **none contained an actual engine/native crash
  dump** — every "abrupt-looking" ending was just a routine, non-fatal in-world Udon script
  exception (`NullReferenceException` mid-EXTERN-call, common and harmless) — and VRChat's own
  clean-quit log marker (`VRCApplication: HandleApplicationQuit`) only appeared in 12 of the 26,
  confirming that "the log doesn't end cleanly" alone (the other heuristic considered) would have
  kept false-positiving on more than half of them, reproducing the exact bug reported. Verified
  both directions with a real, unmocked Windows Event Log query: correctly silent with no crash
  event present, and correctly fires the rejoin when a matching event is simulated.
- [x] **Auto-rejoin now uses VRChat's own `vrchat://launch?id=...` protocol handler** (same
  mechanism VRCX and other community tools use) instead of only the vrchat.com web page, which
  just prompts the browser to hand off to the client anyway - `vrchat://` launches directly.
  Confirmed for real against this machine's actual VRChat install:
  `HKCR\vrchat\shell\open\command` exists and points at VRChat's own `launch.exe`. Falls back to
  the web link automatically if that registration isn't present. Verified both branches with the
  real (unmocked) registry check plus mocked process/event state for the crash-detection side.
- [x] **Custom themes** — `themeSelect` dropdown + `uiTheme` setting; 30-min recheck; `blackgreen` default; seasonal events always win
- [ ] **Registry tools** — VRChat registry backup/restore (Windows registry under VRChat)
- [ ] **Multiple dashboards / customizable widgets** (VRCX-style configurable panels)

### Group alerts (requested)
- [x] **Group alerts** — polls watched groups' posts **and events** → toast + History
- [x] **Notifications** — rich (invite world+link, boop, requestInvite, group), **cached in SQLite**
  until accepted/dismissed; top-right flyout + **Notify sidebar tab**; toast on new

---

## 👻 Terrors of Nowhere

- [x] **Read ToN directly from the VRChat output log (ToNSaveManager now OPTIONAL).**
  `modules/integrations/ton/tonLogReader.js` tails the newest `output_log_*.txt` and parses
  save codes (`[START]…[END]`), round type + map (`This round is taking place at …`),
  terror IDs (`Killers have been set - …`), deaths (`You died.`), round end
  (`Verified Round End`), stuns and damage. Runs alongside the WS; drives live state when
  the WS isn't connected. Captured save codes are auto-decoded to achievements and marked
  on the board (so achievements stay current without ToNSaveManager).
- [x] ToN UI: connect card relabelled — ToNSaveManager is **optional**; the log reader is
  the default.
- [x] **Terror names from killer IDs** — `tonLogReader.js` now looks up each ID in
  `tonData.get().terrors` (the roster fetched from terror.moe, ordered by internal ID);
  falls back to `Terror #N` if the cache is empty or the index is out of range.
- [ ] **Lifetime stats from the log** — the log only has the *current session*, so
  all-time rounds/deaths/etc. still need ToNSaveManager or a decoded save code. Session
  counters work from the log; consider deriving lifetime totals from a decoded save.
- [ ] **Catch up historical rounds/saves** from the log on first read (currently the
  initial full-log pass is suppressed to avoid flooding history; consider importing the
  session's past save codes as backups on startup).

## ℹ️ About page

- [x] About page — app info, NekoSuneVR creator, version, links, update check, contributors
  auto-detected from the GitHub API.
- [ ] **Deeper collaborator / collab-code auto-detection** — beyond GitHub contributors:
  parse `Co-Authored-By:` trailers from git history and any in-source `@author`/credit
  comment markers, and surface named collaborations on the About page.
- [x] **Supporters card** — Patreon/Ko-fi supporters shown on the About page with Discord avatar
  (animated .gif for Nitro users, static .png otherwise, matching Discord's own rules exactly)
  and name-on-hover, linking out to the general Patreon/Ko-fi pages
  (`patreon.com/c/nekosunevr`, `ko-fi.com/nekosunevr`), plus a note pointing supporters who
  haven't linked their Discord to `linkup.nekosunevr.co.uk` yet so they show up too. Fetched from
  main.js (`app:supporters` IPC) to avoid renderer CORS restrictions, fails soft to "could not
  load" if the linkup site is unreachable.
  - **New endpoint on the separate NekoSuneLinkupSite repo**
    (`D:\DEV\NekoSuneVRAPPS\Websites\NekoSuneLinkupSite\SocialLinkUpOnly\api\publicSupporters.js`,
    registered as `GET /api/supporters`): public, no API key at all (by design — a key embedded
    in a shipped desktop app isn't actually secret once someone unpacks it, so a genuinely public
    read-only endpoint is the correct shape here, not a leakable one). Reuses the site's existing,
    already-tested supporter-status logic (`services/supporterStatus.js`,
    `services/discordapi.js`) rather than re-deriving "is this person currently supporting"
    itself. Returns only `discordId`, `username`, `platform`, `avatarUrl` - no email, no payment
    amounts/dates, no internal ids, and banned users are excluded.
  - **Found and fixed a real staleness bug while building this**: the site's existing
    `loadPatreonSupporterMap()` only writes `LinkedAccount.isSupporting` back to the database for
    patrons still found in the live Patreon fetch - someone who fully churned (removed from
    Patreon entirely, not just downgraded) never gets their stale `isSupporting: true` cleared in
    the DB by that function. The new endpoint doesn't trust that DB flag for its final decision;
    it uses the freshly-computed status map the function actually returns instead (which does
    default everyone to inactive first). Verified with a mocked test covering all four cases:
    active Patreon included, churned-but-DB-stale Patreon excluded, active Ko-fi included,
    inactive Ko-fi excluded.
  - **Not deployed by this session** — implemented and tested in isolation (mocked DB/Discord/
    Patreon calls, since this is a live production site with a real database I don't have local
    access to), but the linkup site is a separate repo/deployment the user manages; needs their
    own review + deploy before the About page's supporters card will show real data instead of
    "could not load supporters."
- [x] **In-app update installs, via a standalone updater app** — went through a few iterations
  this session (in-app Electron download → a `/passive` PowerShell+msiexec helper → the final
  design below) before landing on a fully separate helper app, since the thing doing the
  replacing can't live inside the files being replaced.
  - **`updater/`** is its own small, independent Electron app (own `package.json`,
    `main.js`/`preload.js`/`index.html`/`renderer.js`) with a custom branded, animated UI (a
    floating/glowing logo, shimmering gradient progress bar) — not the plain default installer
    UI. "Update available" → "Download & install" now just hands the release asset URL to this
    helper and quits; the helper does everything else visibly: download with a real progress bar,
    install, relaunch.
  - **Packaged as `updater.exe`** on Windows specifically (an electron-builder `portable`
    target — a genuine single-file standalone executable, not a `.ps1` script), built fresh by CI
    for each platform and bundled directly into **both** the NSIS `Setup.exe` and the `.msi` via
    `extraFiles`/`extraResources` (`.github/workflows/build.yml` builds `updater/` before the main
    app on every OS leg and normalizes its output to a fixed path/name first, so the main build's
    config doesn't need to know electron-builder's per-arch output folder naming).
  - **Cross-platform**: Windows runs the `.msi` via `msiexec` (no longer silent - runs the normal
    installer UI, not `/passive`, so it's clearly visible something is installing); Mac extracts
    the release `.zip` and swaps it in for the existing `.app` bundle (`ditto`, ditto - macOS
    built-in, not a bundled tool); Linux replaces an AppImage in place, or opens a `.deb` with the
    desktop's own installer since that needs root this helper can't safely provide unattended.
  - **Verified on Windows**: built the actual `updater.exe` via electron-builder, ran it for real
    against a live download URL and a fake install target, confirmed it downloads a real file
    with correct progress mechanics, correctly waits out (or skips) the parent PID, and reaches
    the actual `msiexec` install step. Found and fixed a real bug this way: passing PID `0`
    (a special "current process group" value to `process.kill`, not a real caller PID) could hang
    the wait-for-exit loop forever.
  - **Mac and Linux paths are NOT verified against real hardware** - implemented from documented,
    standard platform behavior (this dev environment is Windows-only), flagged honestly rather
    than claimed tested.
  - Considered and explicitly declined (per discussion): a full Discord/Squirrel-style
    versioned-folder install architecture (`Update.exe` + `app-X.Y.Z/` folders + a thin launcher
    stub) — that's a genuinely different packaging pipeline (Squirrel.Windows/electron-winstaller)
    that would replace the working MSI/NSIS build entirely; kept the existing, proven MSI/NSIS
    install and added the standalone updater on top of it instead.
- [x] **Fixed: updater failed with `EPERM` trying to download into the install directory.** It
  tried the install directory first (e.g. `Program Files\NekoSuneAPPS\`) and only fell back to
  temp if `fs.accessSync(dir, W_OK)` said that wasn't writable — but that check isn't a reliable
  predictor of real write access on Windows, confirmed by an actual `EPERM` in the wild despite it
  passing. Now always downloads to temp, regardless.
- [x] **Fixed: updater could fail with an opaque, unrecoverable "Command failed: ...Setup-x.x.x.exe
  /S"** in the wild ("already running" style failure) — it only waited for the old app's PID to
  disappear plus a flat 500ms delay before running the silent NSIS install once, with no retry
  and no captured stderr/exit code. Now polls whether the install target file is actually
  unlockable (not just "the pid is gone"), retries the silent install up to 3× with backoff,
  surfaces the real exit code/stderr, and the updater window shows **Retry** /
  **Open download folder** buttons on failure instead of a dead-end static error. The updater
  helper also has its own single-instance lock so a previously stuck attempt can't block a new one.
  (Note: the block above documenting "Windows runs the .msi via msiexec" is stale — 1.0.61
  switched Windows installs to the NSIS `Setup.exe` via `/S`, msiexec/`.msi` is no longer what's
  actually run; flagging here rather than silently rewriting that history entry.)

## 🥽 VR Overlay (experimental — this session)
- [x] **Mirrors the app into a floating VR panel via SteamVR** — `modules/vr/overlay/`
  (`openvrOverlay.js` for the raw OpenVR FFI bindings, `vrOverlayController.js` for the
  screenshot-and-push loop). Settings → "VR Overlay" card, Windows + SteamVR only. First slice is
  **view-only** — see the app floating in your headset, not yet clickable — click-through
  (controller-to-mouse translation) is a planned follow-up once this base mirror is confirmed
  working on real hardware.
- [x] **Talks to OpenVR via `koffi` (FFI), not a compiled native addon** — there's no pure-JS way
  to call a C++ SDK, and koffi needs no build step (lower AV-flag/CI-fragility risk than
  node-gyp, the same reasoning that ruled out `node-global-key-listener` earlier in this
  project). Chosen explicitly over the alternative (a small native Node addon) after discussing
  the tradeoff.
- [x] **Function signatures and the `VR_IVROverlay_FnTable` struct layout are transcribed
  directly from Valve's own `openvr_capi.h`** (OpenVR's official C-compatible API surface,
  published specifically for FFI bindings from other languages) — sourced from a copy bundled
  inside an old, otherwise-unrelated npm package (`ovrjs`), not guessed or hallucinated. Only the
  methods actually called (`CreateOverlay`, `DestroyOverlay`, `ShowOverlay`, `HideOverlay`,
  `SetOverlayWidthInMeters`, `SetOverlayTransformAbsolute`, `SetOverlayFromFile`) get a real typed
  callback prototype; every other field in the 60+-method struct is an opaque pointer purely to
  keep the byte offsets correct, since every field is pointer-sized regardless of which function
  it points to.
- [x] **Verified live against a real, running SteamVR install on this dev machine**: DLL discovery
  (via the Steam install path in the registry, with hardcoded fallbacks), `VR_InitInternal`,
  `VR_GetGenericInterface`, and error-description lookups all behave exactly as documented.
  Confirmed that `VRApplication_Utility` can initialize without a headset but is explicitly denied
  the `IVROverlay` interface ("not available to utility applications"), while
  `VRApplication_Overlay` correctly fails with "Hmd Not Found" when no headset is detected — and
  that failure surfaces as a clear, actionable error message instead of a crash. Also confirmed
  the full 64-field `VR_IVROverlay_FnTable` struct definition is valid and correctly sized (512
  bytes) via koffi.
- [ ] **UPDATE: confirmed broken on real hardware, and the straightforward fix crashes.** A real
  headset test (via a partner) hit `"table.CreateOverlay is not a function"` — the
  `koffi.decode(ptr, PtrType, '*')` call wasn't actually dereferencing the raw OpenVR interface
  pointer into a usable struct. Reproduced this safely using `IVRSystem` (works without a headset)
  as a stand-in, and found the correct-looking fix (`koffi.decode(ptr, StructType)` to read the
  struct, then `koffi.decode(rawFnPtrField, protoType)` to get a callable function from each
  field) - but **actually calling the resulting function segfaults the whole process**, reproduced
  three times through slightly different argument-marshaling approaches. This is a real,
  unresolved problem with calling through a struct-of-raw-function-pointers ("vtable") via koffi,
  not yet a proven-safe pattern. Left the current safe-but-non-functional error in place rather
  than ship something that crashes. Needs real investigation (koffi's own examples/issue tracker,
  or reconsidering the FFI approach) before this feature can actually work.
- [ ] **Follow-ups, not done this pass**: click-through interactivity (translating controller
  laser-pointer intersection into real mouse events on the mirrored UI); the long-standing "VR
  gear battery" placeholder (`modules/vrchat/vr/vrBattery.js`, previously blocked on "no
  well-maintained pure-Node OpenVR binding") can now likely be wired for real using the same
  koffi/openvr_capi.h approach and an `IVRSystem` struct, since that blocker no longer applies —
  once the vtable-calling crash above is actually resolved.

## 📦 Release pipeline
- [x] **Removed macOS builds** — VRChat doesn't run on Mac, so a Mac build of a VRChat companion
  app wasn't serving a real purpose. Removed the `macos-latest` matrix leg and its updater-helper
  build step from `.github/workflows/build.yml`, and the `mac` electron-builder config from both
  `package.json` and `updater/package.json`. Windows and Linux builds unaffected — verified both
  still built and released successfully.
- [x] **VirusTotal scanning in the release pipeline** — CI submits the Windows installers
  (`.exe`/`.msi`) to VirusTotal after they build and links the scan report in the release notes,
  so "installers are unsigned, SmartScreen may warn" doesn't have to be taken purely on faith.
  Handles the large-file upload flow (VirusTotal's direct `/files` endpoint caps at 32MB; the
  NSIS installer is bigger, so it goes through `/files/upload_url` instead) and polls for the
  analysis to finish (up to ~5 minutes) before summarizing flagged-engine counts with a link to
  the full report. Opt-in via a `VT_API_KEY` repo/org secret (a free VirusTotal API key) — skips
  cleanly with no report section in the notes if that secret isn't reachable by this repo.

## 🥽 Requested big features (next session)

### Avatars (own + others)
- [x] **Avatar detail** — modal with image, author, platforms, performance, wear/favourite
- [x] **Switch avatar** — Wear button (`PUT /avatars/{id}/select`)
- [x] **Delete personal avatar** — Delete with Yes/No confirm

### Worlds — create instance + invites
- [x] **Create instance** (Public / Friends+ / Friends / Invite+ / Invite) via `POST /instances`
- [x] **Self-invite** + **Invite friends** (picker) + shareable launch link in world modal

### Groups
- [x] **Invite people to a group** via friend picker
- [x] Group detail: members, roles, posts, gallery, your permissions

### Shared UI
- [x] **Friend-picker modal** (searchable, multi-select)
- [x] **Confirm (Yes/No) modal**

## 🟣 VRCNext-specific (next session)
Confirmed from the [VRCNext](https://github.com/shinyflvre/VRCNext) repo — gaps not already listed above.
- [~] **Profile editor (your own)** — status/status-text/bio/pronouns/bio-links done; pfp &amp; banner upload todo
- [x] **Messenger / message-slot editor** — edit invite & response message slots (Messenger tab)
- [x] **Multi-Invite** — friend-picker multi-select invite to instance/group
- [x] **Inventory** — icons / emoji / stickers / prints (with image proxy for auth-gated images)
- [x] **Avatar browse** — configurable providers (avtrdb + **custom VRCX-style endpoints**) → wear/favourite
- [x] **Group posts** + **group image gallery** — shown in the group detail modal
- [x] **Create group instances** — POST /instances type=group + groupAccessType, with world picker (my worlds + favourites) + access/region selectors in the group modal, auto self-invite
- [x] **Media Library** — local screenshot gallery (folders/metadata filters todo)
- [x] **Configured Start** — launch companion apps (SlimeVR, VRCFaceTracking, …) + optional VRChat
- [x] **VRCVideoCacher** — install/update (official release download) + start/stop the local proxy from the VRChat Tools tab (custom URL via `vvcUrl` setting)
- [ ] **Design customization** — dashboard welcome-screen background + launcher accent colour
  (note: we intentionally ship fixed green + seasonal; make this opt-in)
- [x] **Fast-Fetch cache** — TTL cache + in-flight dedupe for user/world/group/friends
- [x] **Right panel: Favorites section** — favorited friends shown at top of the rail
- [x] **Crash detect + auto-rejoin** — see System section above (WER Event ID 1000 + `vrchat://` relaunch)

## Our pending clusters (from the build plan)

### VR / heavy ⚠️ (need native or large deps — can't test in sandbox)
- [ ] **Neko HUD** (VR overlay) — ⚠️ needs native OpenVR overlay binding (same blocker as VR battery). Ship a small C#/C++ OpenVR helper exe and spawn it.
- [ ] **Playspace Shift** — ⚠️ needs native VR input (grip/stick) — same OpenVR helper.
- [ ] **VoxBoard** (voice-triggered soundboard) — needs offline speech model (VOSK ~50 MB); add as optional download.
- [x] **Avatar Sizer** — done via VRChat's *native* OSC height-scaling API (`/avatar/eyeheight` + `/avatar/eyeheightmin`/`max` + `/avatar/eyeheightscalingallowed`), which works on **any** avatar with no avatar-specific exposed parameters needed. `modules/vrchat/osc/avatarScaling.js` + global hotkeys (Settings → Tools → Avatar Scaling) via a PowerShell `WH_KEYBOARD_LL` hook (`modules/vrchat/osc/keyHookPs.js`), only running while the feature is connected or recording a key.
- [ ] **VR gear battery** — real OpenVR helper to replace the current stub (`modules/vrchat/vr/vrBattery.js`).

---

## 🧹 Polish / known limitations
- [x] Discord RP **buttons** — implemented ("Join World" + "VRChat Profile"); buttons work over local IPC RPC. Note: you can't see your **own** buttons in Discord, only other people viewing your profile can — this is a Discord client limitation, not a code issue.
- [ ] **Favorites page** (dedicated sidebar) listing worlds/avatars/friends with inline remove (currently add/remove via modals + Favs tab).
- [~] Friends panel: avatars for **offline** friends now show with logo.png fallback; group-by-favorite and online count badge todo.
- [x] Rate-limit guard — 429 backoff interceptor + isRateLimited(); every poller skips while rate-limited; stale-cache fallback.
- [x] Cache profile/world/group lookups (VRCX "Fast Fetch") to cut API calls.
- [ ] Verify all VRChat write-actions live (favorite tags, requestInvite slots, invite instanceId format).
- [x] **Fixed: Home tab's VRChat News card could show "Could not load news." with no way to tell
  why**, and no fallback even if news had loaded fine moments earlier. Direct testing against
  the live `hello.vrchat.com` RSS feed this session found no reproducible parse/fetch bug — most
  likely a transient network blip on affected machines — so hardened rather than "fixed" a
  specific root cause: one retry on failure, real errors logged to console instead of swallowed,
  and falls back to the last successfully loaded news (marked "(cached)") instead of blanking
  the card.
- [x] **Fixed: Weather never actually showed up in the VRChat chatbox** even after enabling it
  and adding `{weather}` to a Status preset. It wasn't a fetch/data bug — `{weather}` worked as a
  token, but it had no dedicated Chatbox-tab source row (unlike Now Playing/Stats/Heart Rate),
  so it could only ever be typed manually into a preset, silently sharing the single rotation
  slot with every other preset. Added a proper "Weather" row with its own Off/Own line/Rotate
  toggle in `modules/vrchat/chatbox/chatboxComposer.js` + `renderer.js`'s source grid, and added
  the missing `{weather}` entry to the "Show all tokens" list.
- [x] **Fixed: Linux build could freeze into "Not Responding"** using OSCQR/ShazamOSC's
  capture-source picker — `desktopCapturer.getSources()` (`main.js`) had no timeout and could
  hang indefinitely under Wayland with no PipeWire portal available, freezing the whole app
  rather than just erroring. Added a 6s timeout race on both capture-source call sites, enabled
  Chromium's PipeWire capturer + Ozone auto-detection on Linux startup, and made the IPC handler
  resolve with an error field instead of rejecting. Also fixed `crashGuard.js` running
  Windows-only commands (`tasklist`/`reg query`/PowerShell) unconditionally on every platform
  every 15s with no guard (now a no-op off Windows), added `koffi`'s native binaries to
  `asarUnpack` (VR Overlay's OpenVR bindings couldn't `dlopen` from inside app.asar on any
  platform), and gave the Linux electron-builder target the same explicit `files` whitelist
  Windows already had (previously inherited the broad top-level glob and shipped extra files).
  **Not verified on real Linux hardware** — this dev environment is Windows-only, so these are
  targeted fixes for the specific reported symptoms (the exact "Failed to get sources" error
  message, an actual freeze/hang, and file-based evidence like the `.mount_nekosu` AppImage path
  in the reporter's screenshot), not a full Linux QA pass.

---

## 🎨 Full layout overhaul (feature request)
- [x] Rebuild the app's overall layout/theme/navigation to match the look and feel of
  [VRCNext](https://github.com/shinyflvre/VRCNext) — same *layout style*, not the same
  internal structure/feature set (ours stays different under the hood). Shipped in 1.0.61: wider
  sidebar with icon+label nav and section headers, Home tab as the default landing page (replaces
  Chatbox), VRChat news feed pulled from hello.vrchat.com as the homepage news card, welcome hero,
  metric tiles, Quick Access shortcuts, Recently Visited Worlds.
- [x] **VRChat Quick Launch tab** (MVP) — multi-profile simultaneous VRChat launching via
  VRChat's `--profile=N` flag, matching the multi-account launcher tooling VRCX/VRCNext-adjacent
  community tools provide. See `modules/vrchat/launcher/quickLaunch.js` + the `#quicklaunch` tab.
  Covers: profiles (add/remove/VR toggle/description), Debug GUI / SDK log / UDON log / max FPS /
  free-text custom params, Instance info (Create/Join/Local/None, Create shares one instance
  across every profile launched together), Launch / Launch-all (2s stagger). Auto-detects the
  VRChat exe via the registered `vrchat://` protocol handler, with a manual Browse override.
  - [x] **Per-instance OSC ports** — turned out not to need a proxy at all: VRChat has a real,
    documented launch flag `--osc=<inPort>:<outIP>:<outPort>` (confirmed against
    docs.vrchat.com), so each profile N just gets passed `--osc=9000+2N:127.0.0.1:9001+2N`
    directly (profile 0 = VRChat's own defaults, 9000/9001). `renderer.js`'s `qlSyncOscPorts()`
    then automatically mirrors every non-default profile's ports into Settings → OSC's existing
    "extra targets"/"extra receivers" lists (tracked via a `quickLaunchOscManaged` settings key
    so it only touches entries it added itself, never the user's own manual OSC config) — so
    Chatbox/AudioLink/avatar-param OSC reaches every launched profile automatically, with no
    manual port entry needed.
  - [ ] **Follow-up: MIDI device selection** per profile. Deferred, not started.
  - [ ] **Follow-up: "Auto-layout"** — automatically tile the launched VRChat windows on screen.
    Would need raw Win32 window enumeration/positioning (via `koffi`, already a dependency).
    Deferred, not started.

## 🌍 Localization
- [x] **i18n foundation** — `modules/i18n/i18n.js` (main) + IPC (`i18n:languages`/`i18n:strings`)
  + renderer `t()`/`applyLanguage()` sweep (`[data-i18n]` text, `[data-i18n-ph]` placeholders,
  nav labels via `data-tab`). First-run language picker modal (shown once, if `uiLanguage`
  setting is unset) + a Settings → Language card for changing it later; switches instantly, no
  restart. Seeded with **102 languages** (`modules/i18n/locales/*.json`, flat key→string maps,
  every non-English locale merges over `en.json` so a missing key always falls back to English
  instead of breaking) — the initial 7 (en, ja, es, ru, pl, nl, de) plus every language
  requested afterward: ko, zh, fr, ms, no, pt, ar, bn, hi, id, or, qu, sw, ta, ur, vi, wuu, xh,
  yo, zu, af, sq, am, hy, az, eu, be, bs, bg, my, ca, ceb, ny, co, hr, cs, da, eo, et, fi, fy,
  ka, el, ha, haw, he, hmn, hu, is, it, jv, kn, kk, km, rw, rn, ky, lo, lv, lt, lb, mk, mg, ml,
  mt, mi, mr, mn, ne, ps, fa, pa, ro, sr, si, sk, sl, so, su, sv, tl, tg, tt, te, th, bo, ti, to,
  tr, tk, ug, uk, uz, cy, yi. All 102 files validated for JSON correctness and exact key parity
  against `en.json` (76 keys each). Several lower-resource languages (Quechua, Oriya, Chichewa,
  Kirundi, Wu Chinese, Xhosa, Yoruba, Zulu, Hawaiian, Hmong, and a few others) were flagged by
  the translating passes as worth a native-speaker review — functionally complete but some
  technical-UI terms are best-effort borrowings rather than fixed conventional terminology.
- [ ] **Coverage is partial by design** — this pass only tags the sidebar nav, common
  buttons, and the newly-added Avatar Scaling / Translator / Live Typing / language-picker UI.
  The rest of the app (300–500+ static strings in `index.html`, 400+ dynamic
  `setText`/template-literal call sites in `renderer.js`) is still hardcoded English. Sweeping
  it incrementally (tag more `data-i18n`, wrap more dynamic strings in `t()`) is ongoing work —
  add more locales here too as requested (a handful more beyond the initial 7 were flagged as
  wanted).

## 🗣️ Speech / OCR / TTS translation (phase 2 — built this session)
- [x] **Desktop-audio speech-to-text** — `modules/integrations/osc/stt/desktopSttModule.js`
  (renderer, reuses the `getDisplayMedia({audio:true})` capture technique from
  `shazamOscModule.js`) + `modules/ai/speechToText.js` (main). **Both** engines, user-selectable
  in the Translation tab: cloud (OpenAI/Groq Whisper-compatible `/audio/transcriptions`, sends
  the raw webm clip directly — no decode needed) and local (`@huggingface/transformers` running
  a small Whisper model fully offline in WASM, no native binary; renderer decodes the clip to
  16kHz mono PCM via `OfflineAudioContext` first, since that's the input shape the local model
  needs). Verified: both npm packages install and load cleanly, tesseract.js's worker + language
  download works in this environment. **Not verified end-to-end**: the full
  getDisplayMedia→MediaRecorder→transcribe round-trip needs a real desktop session with actual
  audio and a live API key — recommend a manual smoke test in the built app.
- [x] **Bidirectional**: transcribed text runs through the existing Translator
  (`translateWithSettings`) before being sent to chatbox and/or spoken aloud — same translate
  step Live Typing uses.
- [x] **OCR screen-translate** — `modules/integrations/osc/ocr/ocrTranslateModule.js`, same
  `getDisplayMedia` → canvas capture scaffolding as `oscQrModule.js` with `jsQR` swapped for
  Tesseract.js `recognize()`. 15 common OCR languages in the picker (English, Japanese, Spanish,
  Russian, German, French, Chinese, Korean, Arabic, Portuguese, Italian, Dutch, Polish,
  Ukrainian, Vietnamese) — Tesseract's language codes don't map 1:1 to the app's i18n codes, so
  this is a separate, smaller list.
- [x] **Fixed: OCR failed to start with "worker script...must be an absolute path"** in a
  packaged build. Same root cause as an earlier ffmpeg-static fix this session: tesseract.js
  computes its worker script path via its own internal `__dirname`, which resolves to a path
  inside `app.asar`, and `worker_threads` can't load a script from inside an asar archive at all
  (unlike `require()`/`fs`, which Electron transparently redirects). tesseract.js is already
  unpacked from the asar (`asarUnpack`); the worker path just needed to actually point there -
  patched to swap `app.asar` for `app.asar.unpacked` in the computed default. A no-op in dev,
  where there's no asar at all. Verified by creating and tearing down a real tesseract worker
  with the fix applied.
- [x] **TTS output**, `modules/ai/ttsProviders.js`, **15 engines** selectable in the Translation
  tab, ported from [TTS-Voice-Wizard](https://github.com/VRCWizard/TTS-Voice-Wizard) for feature
  parity: Windows built-in (SAPI via PowerShell `System.Speech.Synthesis`, text piped over
  stdin — not interpolated into the command — so spoken text can't break out of the PowerShell
  command; **verified working**, detected real installed voices and played audio in this
  environment), TikTok TTS, ElevenLabs, OpenAI TTS, Google Cloud TTS, Azure Cognitive Speech,
  Amazon Polly (via `@aws-sdk/client-polly` — SigV4 request signing isn't reasonably hand-rolled
  correctly, so this is the one new npm dependency this pass added), IBM Watson TTS, Deepgram
  Aura, VoiceForge, UberDuck (multi-step: submit → poll → download), TTS Monster (submit →
  download), GLaDOS TTS (self-hosted) and Moonbase Voices (self-hosted local app), plus the
  existing self-hosted Piper/XTTS/other option. All new HTTP-based engines' request shapes were
  verified against mocked responses matching each vendor's real documented API. **Note**: where
  the reference project routes an engine through its own paid gateway (Google, IBM Watson,
  Deepgram all go through a Heroku backend there), this instead calls the real vendor API
  directly with the user's own credentials — no third-party paywall in between.
- [x] **Fixed TikTok TTS** — was hardcoded to a single community proxy (`gesserit.co`) which had
  gone down; now tries a short list of known-working worker proxies in order and checks all the
  response field names different proxies use (`data`/`audio`/`audioUrl`) instead of just one.
  Verified live — successfully generated real audio in this environment.
- [x] **Fixed: TikTok TTS had no voice picker.** The unified TTS card's TikTok engine option
  had no way to choose a voice at all (always used the hardcoded default). Added a voice select
  populated from the same list the old standalone TikTok TTS card used, then removed that old
  standalone card entirely (it was in the Live tab, moved into the Translation tab at runtime,
  and became fully redundant once the unified card covered the same feature).
- [x] **TTS output-device picker** — routes `<audio>`-based engines to any enumerated output
  device via `setSinkId`. Doesn't apply to SAPI/local engines that play through the OS directly.
- [ ] **Routing TTS into VRChat's mic input** — not solvable in pure software. Windows has no
  way to expose one app's audio *output* as another app's *microphone input* without some kind
  of virtual audio device (VB-Cable, Voicemeeter, etc.), which requires installing a driver —
  there's no way around that one step. If the user installs one themselves, the output-device
  picker above will route TTS into it, which VRChat can then pick up as a mic.
- [x] **Fixed packaged-app crash**: "Could not start screen capture — worker script... must be
  an absolute path" (OCR) and the same class of failure would've hit local Whisper too.
  `tesseract.js`/`tesseract.js-core` load a `worker_threads` script, and
  `@huggingface/transformers`'s dependencies (`onnxruntime-node`, `sharp`) load native `.node`
  binaries — neither can be loaded from inside an asar archive (Node needs a real file on disk
  for both). Added `build.asarUnpack` in `package.json` for all of these so electron-builder
  extracts them to `app.asar.unpacked/` instead; Electron then transparently resolves paths into
  the unpacked location. This only manifests in a **packaged** build, not `npm start` — couldn't
  be caught by this session's dev-mode smoke tests, only surfaced once actually installed.

## 🤖 Voice assistant (built this session)
- [x] **Wake-word assistant** — `modules/vrchat/assistant/jarvisAssistant.js` (renderer),
  `modules/ai/assistantBrain.js` (main, LLM-based command interpreter). Listens through an
  actual **microphone** (`getUserMedia`, selectable input device — same enumerateDevices()
  pattern as the AudioLink mic picker), checks each transcript for the configured wake word
  (default `nova`, user-customizable — deliberately not a common assistant name), and only
  acts on speech addressed to it. Reuses the Desktop STT card's speech-to-text engine/API-key
  settings, but captures its own separate mic audio — it does **not** listen to desktop/system
  audio (that's what the Desktop STT card itself is for, a different use case: translating what
  you hear, not commands you speak).
- [x] **Fixed: was listening to the wrong audio source entirely.** Originally used
  `getDisplayMedia` (desktop/system audio, i.e. what's playing through your speakers) for the
  wake-word loop, so it could never hear the user's own voice no matter what mic was selected
  elsewhere — that's what "not detecting right mic" / "heard but no wake word" traced back to.
  The instant-replay screen+audio capture for SOS clips is now a separate, **opt-in** capture
  (its own checkbox, only requests a screen-share prompt if enabled) instead of being the same
  stream the wake-word listener used.
- [x] **Fixed: "Sorry, I couldn't reach my brain just now" gave no way to diagnose the actual
  problem.** `assistantBrain.js`'s command-interpretation call (which reuses the IntelliChat AI
  provider settings) was swallowing the real HTTP error and always returning the same generic
  message. Now surfaces the actual cause (e.g. "Incorrect API key provided", or a connection
  error if a local provider like Ollama isn't running) directly in the reply. Also added upfront
  validation: if the AI provider was never configured at all (blank base URL *and* blank key —
  as opposed to a deliberately keyless provider like Ollama, which has a non-empty base URL),
  `setLive(true)` now fails immediately with a clear message pointing at Settings → IntelliChat,
  instead of only discovering the problem on the first spoken command.
- [x] **Fixed: "who's online" always said nobody was, even when friends genuinely were.** The
  assistant's `getFriends` wiring called `api.vrchatFriends()` (`vrchatApi.getFriends()`, offline
  bucket = false), whose friend objects (`pickFriend()`) never carry an `online` field at all —
  that flag is only ever set by the *reconciled* all-friends call, which fetches both the online
  and offline buckets separately and tags each one. `f.online` was always `undefined` for every
  friend, so the `online` filter was always empty regardless of who was actually online. Switched
  to `api.vrchatAllFriends()`, which returns friend objects with `online` correctly set. Verified
  with a test using the real response shape from `vrchatApi.js`'s `_getAllFriends()`.
- [x] **Commands**: "is `<friend>` online / which world" (reuses the friends list's existing
  `location`/`worldId`/`instanceType` fields, same ones the Friends panel already renders),
  "who's online", "what's my status", "change my status to `<text>`" (sets `statusDescription`
  **only** — the assistant can never touch the bio field, enforced both in the LLM system prompt
  and in the code path itself, verified by a unit test), "what time/date is it" (answered from
  the system clock directly — never guessed by the LLM, which has no real way to know the actual
  current time), and free-form conversational replies for anything else. Responses are spoken
  aloud via the TTS engine above **only** — never posted
  to the VRChat chatbox (a spoken reply has no reason to also be text in-world).
- [x] **SOS — manual trigger only.** Either an explicit spoken "sos" command or the button in
  the UI; **never** auto-triggered. On trigger: invites everyone in a configured trusted-friends
  list (by display name, matched against your live friends list) to your current instance,
  **saves** the rolling instant-replay clip (last 1/5/10 min of shared desktop video+audio,
  configurable) to `Videos/NekoSuneAPPS/` (created automatically if missing), and additionally
  uploads it to a configured Discord webhook if set, so those friends can see what happened
  before they arrive. Saving locally always happens, independent of whether a webhook is
  configured, so the clip is never lost to a failed/missing upload.
- [x] **Fixed: assistant silently doing nothing.** The most common cause is the cloud STT engine
  being selected with no API key ever entered (a very likely fresh-install state) — every clip
  then failed transcription with a generic error that looked identical to "the wake word didn't
  match" from the outside. `setLive(true)` now validates config upfront and fails immediately
  with a clear, specific message instead of silently retrying forever. The status line also now
  shows the actual configured wake word, and surfaces what was transcribed even when it *doesn't*
  match the wake word, so it's obvious whether STT is hearing anything at all versus just not
  recognizing the chosen word.
- [x] **Soft emotional check-in — separate from SOS, and never triggers it.** Every transcribed
  clip (whether or not it's addressed to the assistant) is checked against a small lexical
  cue-list (`modules/vrchat/assistant/emotionCues.js`) for distress or tiredness language. This
  is honest keyword/phrase pattern-matching on the transcribed *text* — not real voice-tone or
  prosody analysis (pitch, pace, pauses), which would need raw-audio feature extraction, a much
  bigger undertaking. If a cue matches, the assistant just asks a caring check-in question
  ("are you doing okay? want me to notify someone?") — the user decides whether to actually
  trigger SOS. Never escalates on its own.
- [ ] **Not verified end-to-end** — same caveat as the Desktop STT feature above: the full
  continuous-listening loop, the friend-status/status-query/status-set VRChat API calls, and the
  instant-replay buffer's long-running recording behavior all need a real account + a live
  desktop session to smoke-test; only the pure dispatch/command logic was unit-tested here
  (mocked callbacks, no live VRChat/audio).
- [x] **Never posts to chatbox — TTS only.** `sendChatboxMessage` was removed from the assistant
  entirely; `respond()` only ever calls the configured TTS engine.
- [x] **World-creation brainstorming partner + general Alexa-like assistant.** Expanded the
  command-interpreter system prompt (`assistantBrain.js`) so the assistant is also a genuinely
  opinionated creative partner for VRChat world ideas/mechanics/pacing/naming, and a general
  conversational assistant (weather, news/current events, general questions, small talk) — while
  explicitly refusing to help write, debug, or explain code even if asked, since that's not what
  this assistant is for.
- [x] **Weather + web search actions.** Added `get_weather` (reuses the app's existing Weather
  feature) and `search_web` actions. Web search is a user-selectable provider:
  **SearXNG** (`modules/ai/webSearch.js`, JSON API against a self-hosted instance, e.g.
  `https://searxng.nekosunevr.co.uk/`) or **DuckDuckGo's Instant Answer API** (no setup, no key,
  but explicitly limited — it only returns an abstract/infobox-style answer and often nothing at
  all for ordinary queries; offered as a no-setup fallback, not a like-for-like replacement).
  Results are summarized into a short spoken answer by the same AI provider used for command
  interpretation.
- [x] **Fixed: SOS instant-replay clips were corrupted/unplayable ("clip is broken").** The
  rolling buffer recorded continuously with a single `MediaRecorder` and pruned old *chunks* by
  age — but only the very first chunk of a continuous recording contains the container's header
  (EBML/Segment/Tracks info), so once that chunk aged out, every exported clip was a webm file
  with no valid header at all. Most players either refused it or showed a single static/garbage
  frame, which is exactly what was reported. Rewrote the buffer to rotate to a **fresh, fully
  self-contained recording every 10 seconds** (`REPLAY_SEGMENT_MS`) and prune whole aged-out
  *segments* instead of chunks, so every segment always has its own valid header. Verified with a
  real ffmpeg-generated two-segment test that the exported result decodes cleanly end-to-end.
- [x] **Clips are now real, playable .mp4 files (were .webm).** The main process now stitches the
  kept segments together with a bundled `ffmpeg-static` binary (`concat` demuxer + transcode to
  H.264/AAC, `+faststart`) instead of a raw byte-concatenation, producing one proper seekable
  `sos-clip-*.mp4` in `Videos/NekoSuneAPPS/`. The same finished .mp4 (not the raw segments) is
  what gets uploaded to a configured Discord webhook, so the webhook attachment can't hit the
  same corruption issue either. `ffmpeg-static`'s binary is unpacked from the asar (like
  `sharp`/`onnxruntime`) since it can't be executed from inside the archive.
- [x] **Fixed, then partially reverted: replay clips weren't actually capturing VRChat.** First
  attempt made the shared screen-capture picker (used by OSCQR/Shazam/Desktop STT/OCR/the SOS
  replay buffer) auto-prefer a source whose window title contains "VRChat" over the whole screen
  — this backfired into clips coming out **solid black**, because Chromium's window-level capture
  on Windows uses GDI/BitBlt, which can't see hardware-accelerated DirectX/Vulkan swapchain
  content (exactly what a game renders into). Reverted to capturing the whole screen, which goes
  through the Desktop Duplication API and correctly composites whatever the GPU actually drew.
  If VRChat is on a second monitor, use the manual capture-source picker in Settings to choose
  that screen explicitly.
- [x] **Fixed: saving a clip spiked CPU/GPU (multiple `ffmpeg.exe` at very high usage).** The
  segment-rotation fix above always recorded webm/vp8 (software-encoded by Chromium) and then
  fully re-encoded through software libx264 on every save, regardless of source codec. Now
  records mp4/h264+aac directly when the system exposes a hardware encoder for it (Windows via
  Media Foundation — the normal case), which offloads the *entire* background recording off the
  CPU, not just the save step; saving then just stream-copies (remuxes) the already-correct-codec
  segments into the final file instead of re-encoding them, which is effectively free. Falls back
  to webm + a real transcode only on systems without a hardware mp4 encoder exposed to Chromium,
  or if a stream-copy remux ever fails for some other reason. Verified both the hardware-codec
  stream-copy path and the software fallback path decode cleanly end-to-end.
- [x] **The fallback transcode (used when a stream-copy isn't possible) auto-detects and prefers
  a GPU encoder** instead of always using CPU-only libx264: tries NVENC (Nvidia), then Quick Sync
  (Intel), then AMF (AMD), each confirmed with an actual throwaway encode (not just checking the
  encoder's compiled in — the hardware/drivers might still not be there), caching whichever one
  actually works for the rest of the process's lifetime, and only falling back to libx264 if none
  of them do. Verified live: this machine's NVENC was detected and a real webm→mp4 transcode
  through it produced a clean, fully decodable file.
- [x] **Fixed: voice assistant kept "hearing" the word "you" out of nowhere and burning through
  the cloud STT rate limit.** Root cause: every listen cycle transcribed unconditionally, even
  ones that were just silence/room noise — precisely the condition Whisper is known to
  hallucinate short stock phrases on ("you" being the classic one). Added a silence gate
  (`isSilentSamples`, RMS energy over the decoded clip against a `vadThreshold` — exposed as a
  "Mic sensitivity" setting: quiet room / normal / noisy room) that skips transcription entirely
  for near-silent clips, plus a small second-layer filter for known Whisper hallucination phrases
  ("you", "thank you", "thanks for watching", etc.) so none of them ever reach wake-word matching
  or the "overheard" status line. Verified all three paths (silence skipped, hallucination
  filtered, real speech passes through) with a mocked capture/transcribe cycle.
- [x] **Voice assistant no longer cuts off a long command mid-sentence.** Recording used to be a
  fixed `clipSeconds` (default 4s) regardless of what was being said. `captureClip` now uses live
  end-of-speech detection (`recordUntilSilence`): it waits at least `clipSeconds`, then keeps
  extending in ~150ms polls for as long as it keeps detecting speech, only stopping once there's
  been ~1.2s of real silence after the last speech - up to a 15s hard cap so continuous background
  noise can't hold the mic open forever. An idle cycle (nothing said at all) still ends right at
  the minimum window, same as before. Verified with mocked audio: pure silence ends at ~1.1s,
  3 seconds of continuous "speech" extends to ~4.1s before cutting off, and continuous noise hits
  the 15s cap.
- [x] **Voice assistant: time in other regions.** "What time is it in Eastern Time?" previously
  always answered with local time regardless of what was asked. `get_time` now carries an
  optional IANA timezone (resolved by the AI provider itself) plus a human-readable place label;
  `modules/vrchat/assistant/timezones.js` is a deterministic alias-table fallback covering common
  USA/Canada/EU/Asia names for when a smaller/local model doesn't reliably produce a real IANA
  name, and asks for clarification on names too broad to guess a single zone for (e.g. "Asia"
  alone spans ~9 time zones). Verified against USA, Canada, EU, and Asia example phrasings plus
  the ambiguous/unknown-place edge cases.
- [x] **More local Whisper models + GPU acceleration.** Added Medium, Large v3, and Large v3
  Turbo (OpenAI's own ~8x-faster distilled variant — "faster whisper" without a separate native
  runtime like the Python/CTranslate2 faster-whisper project, keeping this app's no-native-binary
  approach for STT). Downloads happen automatically the first time a model is actually selected
  and used, never eagerly, and reuse `@huggingface/transformers`'s own cache on subsequent runs
  (no re-download). Added a live download-progress bar since the larger models are multi-GB.
  GPU is now used automatically (DirectML on Windows / CUDA on Linux / CoreML on Mac) with a real
  fallback to CPU — initially tried the library's own `device:'auto'`, which turned out to crash
  ("DML EP can only be used with CPU EPs") because it unconditionally mixes in a WebGPU provider
  that isn't actually usable from the main process; fixed by picking the platform GPU device
  explicitly with an actual try-then-fall-back-to-CPU. Verified live: DML pipeline creation
  succeeds standalone on this machine, and a full transcription run completes without error.
- [x] **Fixed: local Whisper crashed with "ENOTDIR" and models appeared to re-download every
  time.** `@huggingface/transformers`'s own default cache lives under its own node_modules folder
  (`.../node_modules/@huggingface/transformers/dist/.cache/`), which on a per-machine Windows
  install is under Program Files — not writable by a normal, non-elevated user. Models now
  download to `<userData>/models/whisper/<repo>/<model-name>/...` instead (e.g.
  `%AppData%/nekosuneapps/models/whisper/onnx-community/whisper-tiny.en/`), always writable and
  easy to find/inspect. Verified live: files land in exactly that structure, and — since
  `@huggingface/transformers`'s file cache only ever exposes a file at its final path once fully
  downloaded (downloads land in a `.tmp.<pid>.<random>` file first, renamed into place only on
  completion) — a second run with the same model loads straight from disk with an unchanged file
  timestamp, confirming no re-download and no risk of ever running against a partial file.

---

## 💾 Settings-persistence audit (this session)
Prompted by Avatar Scaling's scale always resetting to 1.00m on restart. Cross-referenced every
`<input>`/`<select>`/`<textarea>` with an `id` in `index.html` (249 total) against what
`renderer.js` actually saves/restores, then manually verified every candidate (the mechanical
scan alone has a high false-positive rate for anything saved via a generic/indirect mechanism,
e.g. the TTS engine fields, which already save correctly through `TTS_ALL_FIELD_IDS`).
- [x] **Avatar Scaling scale never persisted at all** — confirmed root cause of the reported
  bug. The slider/number input called `setScale()` but never `saveSetting`, and the controller
  was always constructed with the default `scale: 1`. Now saved (debounced to twice/second,
  since a held hotkey ticks every 50ms) and restored on boot.
- [x] **Avatar Scaling "Safety limits" default was inconsistent** — the checkbox defaults to
  checked in the HTML, but the boot-restore code's fallback default was `false`, so a fresh
  install would silently start with safety off despite showing the box checked. Fixed to `true`.
- [x] **Hotkey recording gave no reason when it silently failed ("hotkey broken, doesn't
  save").** The save/restore/re-arm wiring itself checked out correct (recording a key saves it
  immediately and re-registers it on boot if enabled; the underlying PowerShell `WH_KEYBOARD_LL`
  hook was verified end-to-end with a real synthetic keypress). The actual gap: if the hook
  process fails to actually install (blocked by antivirus, a restrictive execution policy, no
  .NET, etc.), "Record" just silently sat until an 8s timeout and reported the same generic
  "no key captured" — indistinguishable from "nothing was pressed in time", and since nothing
  ever got captured, nothing ever got saved either. `keyHookPs.js` now tracks *why* the hook
  process exited; the record flow health-checks after 2.5s and surfaces that real reason instead
  of waiting out the full timeout.
- [x] **`enableVr` (VR gear battery) had no persistence at all** — only called `vrStart()`/
  `vrStop()`, never `saveSetting`, and had no boot-restore. Fixed to match the identical
  `enableNet`/`enableWindow` pattern elsewhere in the same file.
- [x] **Rusk Laserdome / Twitch Interactive settings only saved as a side effect of clicking
  Start** — editing a field while the feature was already running (or before ever starting it)
  had no way to persist. Added autosave-on-change for both, carefully preserving whichever
  `enabled` flag is already stored so a field edit alone can never flip a feature to auto-start
  on next launch (verified with a test for both the "never started" and "already running" cases).
- Everything else flagged by the initial mechanical scan (~90 more elements) was verified to
  already persist correctly through a generic/object-based save (TTS engines, AI provider,
  autostart checkboxes, weather, Discord OSC/SpotiOSC, RealisticOscLeash, OSC Digital Clock,
  ShazamOSC, ranks, ToN notify/manager) or is intentionally transient by design (search/query
  boxes, one-off action parameters like which soundpad slot to trigger, live manual faders,
  credential fields that save on an explicit Connect action like Discord/HeartRate providers,
  and the VRChat login password specifically must never be saved at all).

---

## ⚙️ Setup reminders
- Run **`npm install`** (adds `discord.js`, `sql.js`).
- VRChat-API features need login on the **VRChat** tab (cookies stored locally; password never stored).
- History DB: `nekosuneapps-history.sqlite` in the app's user-data folder.
- New this session: **Avatar Scaling**, **Translator**, **Live Typing** chatbox, and the
  **i18n foundation** (see sections above). No new npm dependencies were added — the
  global-hotkey approach was switched from a third-party key-listener package (flagged by
  antivirus) to a PowerShell-based `WH_KEYBOARD_LL` hook (`modules/vrchat/osc/keyHook.ps1` +
  `keyHookPs.js`), matching the existing shell-out pattern already used by `mediaKeys.js`.
