# Changelog

All notable changes to **KitsuNexus** are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

## [1.0.69] - 2026-08-09

### Added
- **Project support and donation information.** The README now documents ways to support
  NekoSuneProjects, including hosting and maintenance goals, cryptocurrency options, GitHub
  Sponsors, network-safety guidance, and thanks for financial and community contributions.
- **Reusable GitHub Actions packaging prompt.** Added a Markdown prompt that can be copied into
  other projects so Claude or another assistant asks for the current workflow first, explains
  planned changes, researches whether the requested package targets are supported for that
  project's stack, and then applies the same AMD64 Ubuntu self-hosted packaging approach where
  possible.
- **Self-hosted runner troubleshooting notes.** Added guidance for repeated GitHub runner AAD/RSA
  credential messages and the Ctrl-C `TaskCanceledException` shutdown block. These are runner
  listener/service lifecycle logs rather than application packaging failures; running the runner
  through its service wrapper is recommended instead of using an interactive terminal.

### Changed
- **The application is now KitsuNexus.** Rebranded NekoSuneAPPSVRC throughout the desktop app,
  standalone updater, package/bin metadata, Electron and Microsoft Store identities, Discord and
  backend labels, release workflow, issue templates, documentation, policies, community-rank
  wording, and user-facing runtime messages. The release version is now `1.0.69`.
- **Brand artwork and release filenames now match KitsuNexus.** Updated the GitHub social preview,
  Microsoft Store hero, and cute README banner without changing their fox artwork, then renamed
  the three final PNGs from `nekosuneapps-*` to `kitsunexus-*` and updated their references.
- **The Windows updater now lives outside the install directory.** The packaged helper is copied
  to `%LOCALAPPDATA%\KitsuNexus\Update.exe`, allowing normal app updates to replace files under
  Program Files without replacing the running updater. Windows updates prefer published ZIP
  packages and copy their contents in place while excluding the updater executable.
- **Portable installs keep their data beside the executable.** A `portable` marker or existing
  `Data` directory now redirects Electron's user-data path to the portable installation folder.
- **Release workflow now cross-builds desktop packages from one AMD64 Ubuntu runner.** The GitHub Actions build matrix now targets Windows x64, Linux x64 and Linux arm64 while running every leg on the Linux X64 self-hosted runner. It installs Ubuntu build dependencies including Wine/NSIS where available, caches npm plus Electron downloads, uploads all generated packages, and keeps the existing tag-based release, VirusTotal and Discord announcement flow with updated artifact labels.

### Fixed
- **Updater handoff no longer depends on a helper inside the app being replaced.** Startup now
  bootstraps the external updater before update checks, and relaunch errors identify the expected
  LocalAppData helper path clearly.
- **Language selection is easier to complete.** The first-run language picker now has a compact,
  responsive card, an explicit button type, and Enter-key submission.

## [1.0.68] - 2026-08-07

### Added
- **New AI tab — AI features now live in one place.** The IntelliChat (AI provider) settings and
  the Voice Assistant were previously split across two unrelated tabs: IntelliChat was defined in
  Settings but silently relocated at runtime onto the Translation tab, and the Voice Assistant sat
  on the Translation tab next to the TTS/STT/OCR cards despite not being a translation feature.
  Both now live on a dedicated **AI** tab, so configuring the AI provider and the assistant that
  uses it happens in one spot. Translation keeps TTS, Desktop STT, OCR and the Translator.

### Changed
- **Sidebar regrouped into meaningful sections.** The nav previously dumped 25 of its buttons
  under a single "VRChat" heading, with unrelated items ("Social" holding Translation, OAuth) in
  the wrong group. It's now split into **VRChat**, **Friends & Social**, **Avatars & Media**,
  **AI & Speech**, **Games**, **Tools**, **Integrations** and **General**, so each feature sits
  under a heading that describes it. No tabs were removed or renamed — only regrouped and
  reordered. (Anyone who has drag-reordered their sidebar keeps their saved order; the new AI
  button appends to the end.)
- **Tools and Games are now their own sidebar categories.** Tools and Terrors were both sitting in
  the "General" catch-all next to Settings/Docs/About/OSC Log, which buried them. **Tools** is now
  its own heading holding Tools, VRChat Tools, OSC Apps and AudioLink — the utility tabs,
  previously scattered between "General", "Integrations" and "VRChat". **Games** is its own
  heading for Terrors of Nowhere, so game-specific pages have somewhere to live as more are added.
- **Heart Rate and Weather moved to Integrations.** Both were listed under "VRChat", but neither
  is a VRChat feature — they pull from external services (Pulsoid and the weather API) and feed
  the result into VRChat, which is exactly what the other Integrations tabs do. Integrations now
  holds Live, Discord, OAuth Accounts, Heart Rate, Weather and the OBS Overlay (the last moved out
  of "General"), leaving **General** for Stats, Settings, Docs, About and OSC Log, and **VRChat**
  for the tabs that actually drive VRChat itself.

### Fixed
- **Possible "Exception Processing Message 0xc0000005" crash dialog on launch.** The VR Overlay's
  `koffi` FFI binding was imported at the top level of `modules/vr/overlay/openvrOverlay.js`,
  which is loaded at startup by `main.js` through `vrOverlayController`. Requiring `koffi` itself
  immediately `LoadLibrary`s its native `koffi.node` addon, so **every** user performed a native
  addon load on **every** launch just to have the VR Overlay available — with no headset and no
  SteamVR needed to trigger it. If that native load faulted (a corrupted or antivirus-quarantined
  `.node`, an ABI mismatch, or the binary missing from the packaged build) it took the whole app
  down before any window existed, surfacing only as a bare Windows access-violation dialog with
  no JS stack to diagnose. `koffi` is now loaded lazily on first actual VR Overlay use, matching
  the existing lazy pattern used for `ffmpeg-static` and `vrnotications`, so a broken `koffi` can
  now only ever disable the VR Overlay feature itself instead of preventing startup.
- **Packaging: koffi's native binary is now explicitly unpacked from the asar.** `asarUnpack`
  listed `node_modules/koffi/**/*`, but koffi 3.x ships its actual native binary in a separate
  `@koromix/koffi-win32-x64` package, which was only being unpacked by electron-builder's
  automatic `.node` detection rather than by intent. Added `node_modules/@koromix/**/*` so a
  future koffi restructure can't silently reintroduce the "can't dlopen from inside app.asar"
  bug that was already fixed once in 1.0.64.

## [1.0.67] - 2026-08-06

### Fixed
- **Updater: fixed "Failed to uninstall old application files" (exit code 2) error.** The NSIS
  uninstaller was failing because KitsuNexus processes were still holding file locks. The
  updater now kills running KitsuNexus instances before attempting uninstall, and if the
  uninstaller still fails (exit code 2), it manually cleans up the install directory so the new
  installer can proceed. Error messages also now suggest running the installer as Administrator.
- **Live Typing with Translation no longer lags while typing.** Every keystroke was immediately
  triggering a translation API call plus a redundant IPC round-trip to fetch translator settings
  from disk. Added an 800ms debounce so translation only fires after the user pauses typing,
  and cached translator settings for 5 seconds to eliminate per-keystroke IPC overhead.
- **Audio slider persistence no longer floods disk with writes.** Dragging the gain/boost sliders
  (and avatar scaling smoothing, background opacity/blur) was writing the entire electron-store
  config to disk on every pixel of drag. All slider `input` handlers now debounce their
  `saveSetting` calls by 300ms.
- **Rightbar friend search no longer freezes the UI on large friend lists.** `renderRightbar`
  (which filters the full friend cache, builds HTML for all friends, and assigns `innerHTML`) was
  firing on every keystroke uncapped. Now debounced at 150ms.
- **ToN board search debounced at 150ms** to prevent full DOM rebuilds on every keystroke.
- **World name resolution now runs in parallel** instead of sequential IPC round-trips. N unique
  world IDs previously made N serial API calls; now uses `Promise.allSettled` for uncached IDs
  and a single DOM pass to apply results.
- **VR overlay capture no longer blocks the main process event loop.** Replaced synchronous
  `writeFileSync` with `await fs.promises.writeFile` and added a minimized-window skip so captures
  don't run when the app is hidden.
- **Photo Relay no longer re-uploads old images on startup.** `fs.watch` on Windows can fire
  spurious events for existing files when the watcher starts, and the `seen` Set was empty on
  startup, so every existing photo was treated as new. Now pre-scans the photos directory on
  startup to populate the `seen` Set, and clears it on restart.

### Changed
- **Default NSIS install directory changed from AppData to Program Files** (`${PROGRAMFILES}\KitsuNexus`).
  Users can still choose a custom location during install. Existing installs in AppData are not
  affected — the updater will continue to use whichever directory the previous install used.

## [1.0.66] - 2026-08-04

### Added
- **Discord Activity (live VRChat status panel) + an official shared Discord bot mode**,
  backed by a new standalone backend service that lives on its own branch in this repo
  ([`feature/discord-backend-server`](https://github.com/NekoSuneProjects/KitsuNexus/tree/feature/discord-backend-server),
  its own `package.json`/Docker deployment) rather than as a subfolder of the Electron app —
  it's never bundled into an installer. This exists because a bot token — and the OAuth client
  secret needed to identify users — can never be safely shipped inside a distributed Electron
  app (the asar is trivially unpackable), so both now live only on this backend, which the
  desktop app talks to over an authenticated HTTP API instead.
  - The backend runs a persistent `discord.js` gateway connection for the shared bot
    (`discordBotGateway.js`), a Discord OAuth2 "identify" code exchange that never leaves the
    server (`auth.js`, `routes/oauth.js`), a live VRChat status feed pushed by each desktop
    client and re-filtered server-side through the same join/active/ask/busy privacy gate
    already used for Rich Presence (`statusStore.js`, `routes/status.js`), and a static
    Discord Activity iframe frontend (`public/activity/`) using `@discord/embedded-app-sdk`.
  - Electron gained a "Log in with Discord" flow (`modules/oauth/providers/discordIdentity.js`,
    modeled on the existing Twitch loopback OAuth pattern), a periodic status pusher
    (`modules/integrations/discord/statusPush.js`, fed by a new `getVrcContextSnapshot()` getter
    on `discord.js` so it reuses rather than re-derives the existing Rich Presence data), and an
    "official bot" mode on the Voice Bot card (`discordBot.js`'s new `startOfficialBot`/
    `stopOfficialBot`/`setMuteOfficial`/`setDeafOfficial`) that polls the backend instead of
    running a local token-based gateway client, producing the identical state shape so the
    existing OSC/chatbox pipeline needed no changes.
  - Defaults to the official `https://kitsunexus.nekosunevr.co.uk` deployment
    (`DEFAULT_NEKOSUNE_BACKEND_URL` in `main.js`), but — unlike the locked RPC app ID — this is
    intentionally user-overridable: a new "Backend URL" field on the Voice Bot card
    (`nekosuneBackendUrl` setting) lets self-hosters point the app at their own deployment
    instead, since a self-hoster runs their own bot/OAuth app entirely and needs nothing from
    the official one.
  - **Not deployed by this session** — implemented and locally verified in isolation (backend
    routes exercised directly over HTTP; every changed/new file passed `node --check` and a
    plain-Node require-resolution check), but end-to-end use requires actually deploying the
    official host, filling in that branch's `.env` secrets, and one-time Discord Developer
    Portal setup (OAuth redirect + Activities URL Mapping) documented in that branch's
    `README.md`.

### Changed
- **Discord Rich Presence Application ID is now fixed and no longer user-editable.** Previously
  the "Discord Application (Client) ID" field defaulted to a shipped ID but users could freely
  edit or clear it. It's now pinned to `1534208250046578790` at every layer — the input in the
  Discord tab (`index.html`) is disabled/readonly, `renderer.js` forces the saved config and every
  outgoing `discord:start` payload to this ID regardless of what's stored, and `main.js`'s
  `discord:start` IPC handler overwrites `clientId` on the way into `startDiscord()` as a final
  backstop. The Discord Voice Bot's separate "Application ID (for invite)" field is unaffected —
  that's an optional user-supplied bot app ID, unrelated to Rich Presence.

### Fixed
- **"Invite link" on the Voice Bot card always showed "Connect first, or enter the Application
  ID..." when the official KitsuNexus bot mode was selected**, even though that message only
  makes sense for the bring-your-own-bot mode. Root cause: the button's click handler always
  called the own-bot `api.botInvite()` path regardless of which mode was active, and the
  official bot mode never sets `discordBot.js`'s internal `appId` (that only gets set by a real
  gateway login, which official mode doesn't do). Fixed by branching on the selected mode: in
  official mode, the button now opens the backend's web dashboard
  (`<backend URL>/dashboard`, new `nekosune:getBackendUrl` IPC handler + `api.openExternal`) in
  the system browser instead, since that's the actual way to add the official bot to a server.

## [1.0.65] - 2026-07-28

### Added
- **Weather is now a first-class Chatbox source**, same as Now Playing/Stats/Heart Rate: a
  "Weather" row on the Chatbox tab's per-source grid with its own Off / Own line / Rotate toggle
  (`modules/vrchat/chatbox/chatboxComposer.js`). Previously the only way to see weather in
  VRChat's chatbox was to manually type the undocumented `{weather}` token into a Status preset,
  where it silently competed with every other preset for the single shared rotation slot — easy
  to set up and still never actually see it show up. `{weather}` still works in presets too. Also
  added `{weather}` to the Chatbox tab's "Show all tokens" reference list, where it was missing
  entirely.

### Fixed
- **Linux build could freeze into "Not Responding"** when using OSCQR/ShazamOSC's capture-source
  picker. Root cause: `oscApps:captureSources` (`main.js`) called `desktopCapturer.getSources()`
  with no error handling and no timeout — under Wayland (GNOME/KDE's default now) without a
  PipeWire screen-cast portal available, that call can hang indefinitely instead of failing,
  leaving the awaiting main-process IPC handler stuck forever and freezing the whole app, not
  just erroring in the OSC Apps tab (which is the "Failed to get sources" message actually
  reported). Fixed by: enabling Chromium's PipeWire capturer + Ozone auto platform hint on Linux
  startup so capture has a real chance of working under Wayland; wrapping both
  `desktopCapturer.getSources()` call sites in a 6s timeout race so a missing portal fails fast
  instead of hanging forever; and having the IPC handler resolve with an `error` field instead of
  rejecting, so the renderer always gets an answer either way.
- **`crashGuard.js` (auto-rejoin after a real VRChat crash) had no platform guard** and ran
  Windows-only commands (`tasklist`, `reg query`, PowerShell `Get-WinEvent`) unconditionally every
  15 seconds on every platform, including Linux/Mac, where those commands don't exist — each tick
  spawned a shell that just failed (ENOENT) for a feature that could never actually detect a
  crash there anyway. Now a no-op off Windows, matching every other Windows-only module in this
  codebase.
- **Packaging: `koffi`'s native binaries (used by the VR Overlay's OpenVR bindings) weren't in
  `asarUnpack`**, so on any platform they'd fail to `dlopen` from inside the packaged app.asar the
  moment that code path is required. Added `node_modules/koffi/**/*` to `asarUnpack`.
- **Packaging: the Linux build had no `files` override**, unlike Windows, so it silently inherited
  the broad top-level `files: ["**/*"]` glob and shipped extra non-runtime files the Windows
  installer already excludes. Linux now uses the same explicit file whitelist as Windows.

## [1.0.64] - 2026-07-24

### Fixed
- **Home tab VRChat News section now actually shows news and stays up to date.**
  A background poller runs every 5 minutes, merges new articles into the
  persisted cache, and pushes the result to the renderer automatically — the
  home tab refreshes without the user having to click anything. Items are
  accumulated across sessions (deduped by URL, capped at 30, newest first), so
  previously-seen news is never lost when the feed rolls older items off.
  A manual ↻ refresh button and "X ago" last-updated label are shown in the
  news card header. On fetch failure the cached list is shown with a note; if
  nothing is cached yet a Retry button appears instead of a dead "Could not
  load news" message.
- **News card is now a scrollable area** (max 320 px, thin auto-scrollbar) so
  all accumulated articles are reachable without the card growing unbounded.
  RSS fetch limit raised from 6 to 20 items per poll so the list fills quickly.

## [1.0.63] - 2026-07-23

### Fixed
- **Auto-updater now actually installs the new version instead of silently claiming success.**
  Root cause: Node's `execFile` calls `CreateProcess` and waits for the NSIS stub process, which
  exits immediately when UAC elevation is involved — the actual elevated installer runs in a
  separate process that `execFile` never waits for. Fixed by driving NSIS installs through
  PowerShell `Start-Process -Wait`, which correctly blocks until the elevated process finishes.
- **Updater now performs a clean uninstall before installing the new version.** Before downloading,
  it reads the current install directory and uninstall path from the Windows registry. After
  download, it runs the existing uninstaller `/S` first (removing stale files), then runs the new
  installer `/S /D=<originalDir>` so the new version lands in exactly the same place the user
  originally chose. Registry info is captured before uninstalling since the uninstaller removes
  those keys.
- **Updater window now shows a real-time step list** (Waiting → Downloading → Removing old version
  → Installing → Relaunching) with animated spinner on the active step and a green checkmark on
  each completed step, replacing the single indeterminate spinner during the install phase.

### Added
- **VRChat Quick Launch profiles now get automatic, non-colliding OSC ports.** Profile 0 keeps
  VRChat's own defaults (send 9000 / receive 9001); every other profile N is launched with
  `--osc=9000+2N:127.0.0.1:9001+2N` (VRChat's real, documented `--osc=<inPort>:<outIP>:<outPort>`
  launch flag — no proxy needed). Each profile row shows its computed ports. Non-default
  profiles' ports are automatically mirrored into Settings → OSC's existing "extra targets"/
  "extra receivers" lists as soon as a profile is added/edited/removed, so Chatbox/AudioLink/
  avatar-param OSC reaches every simultaneously-launched VRChat instance without manually typing
  ports into Settings. Only entries Quick Launch itself added are ever touched (tracked via a
  `quickLaunchOscManaged` settings key), so any OSC targets/receivers you configured by hand are
  left alone.

## [1.0.62] - 2026-07-19

### Added
- **VRChat Quick Launch tab** (`modules/vrchat/launcher/quickLaunch.js`, new `#quicklaunch`
  sidebar tab) — launch multiple simultaneous VRChat game clients, each signed into a different
  account. Design researched from [VRCNext](https://github.com/shinyflvre/VRCNext)
  (`RelayController.cs`'s launch-and-join flow) and a community VRC Quick Launcher's UI, adapted
  to this app's own launch mechanism:
  - Each **profile** is passed VRChat's own `--profile=N` launch flag (real, undocumented, the
    same flag VRCNext uses) — every index gets a fully independent local settings/login state, so
    N processes can each be signed into a different account at once, not just N windows of the
    same account.
  - Per-profile launch options map to real VRChat CLI flags: VR/desktop toggle (omits/adds
    `--no-vr`), Debug GUI (`--enable-debug-gui`), SDK log levels (`--enable-sdk-log-levels`),
    UDON debug logging (`--enable-udon-debug-logging`), max FPS (`--fps=N`), plus a free-text
    custom-parameters field appended as discrete argv entries (never shell-concatenated, so it
    can't be used for command injection).
  - **Instance info** has four modes: Create (calls the existing `vrchatApi.createInstance` /
    `vrchat:createInstance` IPC handler once per Launch-all batch, so every selected profile joins
    the *same* fresh instance together, not each their own), Join (paste an existing instance
    location string), Local, and None — Create/Join build a `vrchat://launch?ref=vrchat.com&id=…`
    URI appended to the launch args.
  - The VRChat executable is **auto-detected** by reading the `HKCR\vrchat\shell\open\command`
    registry key VRChat's own installer registers for the `vrchat://` URI handler (the same key
    `modules/vrchat/tools/crashGuard.js` already reads the other direction for crash-rejoin),
    resolving to `start_protected_game.exe` next to it — this finds the real install path
    regardless of which drive/Steam library it's on, with a manual Browse override stored in
    settings for anyone it doesn't find. Launches the game exe **directly** (`spawn`, not through
    `steam://`/`-applaunch`), so Steam doesn't need to be running and custom args are never
    stripped the way the `steam://` protocol strips them.
  - "Launch selected" stages launches ~2s apart rather than all at once, so several simultaneous
    game-client cold starts don't thrash disk/GPU init.
  - Deferred to a follow-up (tracked in `TODO.md`): per-instance OSC port remap, MIDI device
    selection, and automatic window-tiling ("Auto-layout") — not built this round.

### Fixed
- **Auto-updater could fail with an opaque "Command failed: ...Setup-x.x.x.exe /S"** and no way
  to recover short of hunting down the downloaded installer manually (`updater/main.js`). Root
  cause: the updater only waited for the old app's PID to disappear (`waitForPidExit`), then a
  flat 500ms grace period, before running the silent NSIS install (`/S`) exactly once via
  `execFile`, with no retry and no captured stdout/stderr/exit code — so any lingering file lock
  (a subprocess not fully torn down, Windows Defender/AV scanning the fresh download, etc.) turned
  into an unrecoverable, unexplained dead end. Now:
  - `waitUntilFileUnlocked()` polls (up to 12× / 300ms apart) whether the install target can
    actually be renamed-to-itself — a real "is it free yet" check — instead of trusting a flat
    delay after "the pid is gone".
  - The silent install itself retries up to 3× with a 1.5s backoff before giving up.
  - Failures now surface the real exit code / captured stderr instead of Node's generic
    `execFile` message.
  - The updater window (`updater/index.html` / `updater/renderer.js`) shows **Retry** (re-runs
    just the install step against the already-downloaded file, no re-download needed) and
    **Open download folder** buttons on failure instead of a static, dead-end error message.
  - The updater helper now has its own `requestSingleInstanceLock()` (mirroring the main app's),
    so a previously stuck/crashed updater window can't block a fresh update attempt.
- **VRChat News card could show "Could not load news." with no way to tell why** (`main.js`'s
  `vrchat:news` handler), with no fallback even if news had loaded fine moments earlier. Direct
  testing against the live `hello.vrchat.com` RSS feed found no reproducible fetch/parse bug in
  the code itself, so this is a resilience hardening rather than a specific root-cause fix:
  - One retry (800ms delay) on fetch/parse failure before giving up.
  - The XML parser now passes an `onError` callback (current `@xmldom/xmldom` API) so a feed
    parsing hiccup is logged via `console.error` instead of silently vanishing.
  - The last successfully fetched news list is cached (`settings` → `vrchatNewsCache`) and served
    — marked with a small "(cached)" note in the UI — instead of blanking the whole card to an
    error string when a fetch genuinely fails.

## [1.0.61] - 2026-07-18

### Changed
- **Photo Relay now posts a rich Discord embed instead of a bare file upload**, when Screenshot
  Metadata is also turned on. Matches the format of the old relay-server setup: title "VRChat
  Photo Log Entry", world name linking to its VRChat page, every player linking to their VRChat
  profile (chunked across multiple fields if the player list is long), and the screenshot itself
  rendered inside the embed card (not a separate raw attachment below it). Metadata is embedded
  into the file first, then read back, so Photo Relay and Screenshot Metadata no longer race each
  other on the same new file. If Screenshot Metadata is off, Photo Relay uploads plain as before.

## [1.0.60] - 2026-07-18

### Added
- **Discord release announcements.** The release CI job now posts a Discord embed (username
  "KitsuNexus Release", app icon, changelog notes, and direct download links for whatever
  installers actually built) whenever a version tag is released. Opt-in via a
  `DISCORD_WEBHOOK_URL` repo secret — skips cleanly with no post if that secret isn't set.
- **Screenshot Metadata (Settings → Photo Relay page)** — VRCX-compatible metadata toggle.
  When on, every new VRChat screenshot gets the current world, instance, and the players who
  were with you embedded as a `Description` PNG chunk, in the exact same iTXt chunk format and
  JSON shape [VRCX](https://github.com/vrcx-team/VRCX) itself writes (verified against VRCX's
  own source), so tools built to read VRCX's metadata can read files this app writes too. The
  image pixels are untouched — only invisible metadata is added. Off by default.

### Fixed
- **VRChat photos folder was always assumed to be `Pictures\VRChat`**, even when VRChat's own
  `config.json` (`AppData\LocalLow\VRChat\VRChat\config.json`) redirects screenshots to a custom
  `picture_output_folder` (e.g. a different drive). The Media Library, the background picker's
  "Load VRChat photos" browser, the folder-shortcut button, and Photo Relay (auto-upload to
  Discord) now all resolve the real folder from that config value live (re-read each time, no
  restart needed), falling back to the default `Pictures\VRChat` only when `config.json` is
  missing or doesn't set that key.

## [1.0.59] - 2026-07-18

### Added
- **Home dashboard** — new default landing tab (replaces Chatbox as the startup tab): a welcome
  hero with your avatar/display name/status, metric tiles (friends online, total VRChat players,
  Steam/Quest split), Quick Access shortcuts to every tab, a Recently Visited Worlds list pulled
  from the history log, and a VRChat News feed (latest 6 posts from hello.vrchat.com/blog,
  cached per home-tab visit, click-through opens in your browser).
- **Layout overhaul** — sidebar widened from 76px to 190px with icon + label on every nav button
  and visible section headers (VRChat / Social / General); brand area now shows the logo plus
  "KitsuNexus"; Launch button is a full-width pill; sidebar auto-collapses to 64px icon-only
  below 820px width; cards lift on hover (translateY -2px with an accent shadow).
- **Custom backgrounds** (Settings → Background) — 8 built-in gradient presets (Aurora, Neon,
  Sakura, Ocean, Forest, Gold, Void, Dusk), a custom image picker (stored as a file path, not
  base64), a VRChat photos browser (last 48 shots from `Pictures\VRChat`), and Dim (5–85%) /
  Blur (0–24px) sliders — all persisted across launches.
- **Trust level ladder** shown on the friend/user profile modal's info tab.
- **Pronouns and bio links** are now editable (load + save) in the profile editor.
- **Favorites backup** — export/import friend and world favourites to/from JSON.
- **Terror of Nowhere** — terror IDs now resolve to names via a cached `tonData` lookup.

### Fixed
- **Offline friends showed blank space instead of an avatar placeholder.**
- **Auto-updater could install to the wrong directory (critical).** The updater was downloading
  the `.msi` release asset and running it via `msiexec`, which installs to its own default path
  instead of the user's existing NSIS install directory, then relaunched the old binary. Fixed by
  preferring the NSIS `Setup.exe` asset and running it with `/S` for a silent in-place upgrade to
  the same registered directory, plus a registry-lookup fallback (`findRelaunchExe()`) for cases
  where the install path shifted between the old and new install.

## [1.0.58] - 2026-07-08

### Fixed
- **Supporters card always showed "No supporters linked yet"**, even with active supporters on
  the linkup site — the `app:supporters` handler in `main.js` called `axios.get(...)` but never
  actually required `axios` in that file, so every call threw `ReferenceError: axios is not
  defined` and was silently swallowed by the fail-soft `catch`. Added the missing `require`.
  Also fixed the About page collapsing a failed fetch and a genuinely empty supporter list into
  the same message — a real fetch error now shows "Could not load supporters (offline?)." instead
  of "No supporters linked yet", so this class of bug is visible next time instead of silent.

## [1.0.57] - 2026-07-08

### Added
- **Supporters card on the About page** — shows Patreon/Ko-fi supporters (via their linked
  Discord account on linkup.nekosunevr.co.uk) with their Discord avatar, name and platform on
  hover, linking out to the Patreon/Ko-fi pages. Includes a note pointing supporters who haven't
  linked yet to linkup.nekosunevr.co.uk so they show up too, and a message about how support
  helps fund ongoing development. Backed by a new public, unauthenticated endpoint on the linkup
  site (`GET /api/supporters`) — no API key, since embedding one in a shipped desktop app would
  just leak it to anyone who unpacks it; deliberately returns only non-sensitive fields (no
  email, no payment amounts, no banned users).
- **The Multi-line chatbox's Now Playing line now shows the progress bar and elapsed/duration
  time**, not just the bare song name. The `{songbar}`/`{songtime}` values were already computed
  and available to Status presets, they just weren't wired into this specific line - fixed by
  actually using them there too. Falls back to just the song name when a source doesn't report
  duration.

### Fixed
- **Discord Rich Presence's elapsed timer reset every time your status changed**, instead of
  showing how long the app has actually been running. Root cause: the code was reading a
  `startTime` property directly off the `discord-rpc` library's `Client` object - which doesn't
  actually exist (confirmed against the library's own source) - so the real timestamp anchor was
  always `undefined`, and Discord fell back to showing time-since-last-update instead of a fixed
  start time. Now anchors to a real timestamp taken once on connect and reused for every
  presence update afterward. Verified with a mocked Discord client: the timestamp stays
  identical across multiple simulated status changes.

## [1.0.56] - 2026-07-08

### Added
- **VirusTotal scanning in the release pipeline.** CI now submits the Windows installers
  (`.exe`/`.msi`) to VirusTotal and links the scan report in the release notes, so "installers
  are unsigned" doesn't have to be taken on faith. Opt-in via a `VT_API_KEY` repo secret (a free
  VirusTotal API key) — skips cleanly with no report section if that secret isn't set.

### Removed
- **macOS builds.** VRChat doesn't run on Mac, so a Mac build of a VRChat companion app wasn't
  serving a real purpose. Windows and Linux are unaffected.

### Known issues
- **VR Overlay (experimental, added in 1.0.55) doesn't work yet.** Real-headset testing found it
  fails with "table.CreateOverlay is not a function". Investigating why turned up something more
  serious: the straightforward fix (properly decoding the raw OpenVR interface pointer into
  callable functions) reliably **crashes the process** in this environment, reproduced three
  separate times through slightly different approaches — not just a JS error. Rather than ship a
  "fix" that trades a safe dead-end for a crash, the current safe-but-non-functional behavior is
  being left in place until this is solved properly. Still needs real work.

## [1.0.55] - 2026-07-08

### Added
- **VR Overlay (experimental)** — Settings → mirrors the app into a floating panel visible in
  your headset via SteamVR, so you don't have to tab out to desktop. First version is view-only
  (not yet clickable in VR — that's a planned follow-up once this base mirror is confirmed
  working on real hardware). Windows + SteamVR only. Talks to OpenVR via `koffi` (FFI) rather
  than a compiled native addon — no build step, lower risk than node-gyp. The function
  signatures/struct layout are transcribed directly from Valve's own `openvr_capi.h` (OpenVR's
  official C-compatible API surface for FFI bindings), not guessed. Verified live against a real,
  running SteamVR install on this machine: DLL discovery, initialization, and error handling all
  behave exactly as expected (including correctly detecting and reporting "no headset connected"
  rather than crashing) — the one thing that could **not** be verified in this environment is the
  actual overlay rendering itself (creating/showing/updating the panel), since that needs a
  physically connected, powered-on headset, which this dev machine doesn't have.

### Changed
- **Crash auto-rejoin now launches straight into VRChat via its own `vrchat://launch?id=...`
  protocol handler** (the same mechanism VRCX and other community tools use) instead of only
  opening the vrchat.com web page and hoping it hands off to the client. Confirmed the protocol
  handler registration and target command directly against a real VRChat install
  (`HKCR\vrchat\shell\open\command` → VRChat's own `launch.exe`). Falls back to the web link
  automatically if that registration isn't present for some reason.
- **The updater now always downloads to a temp folder**, never the install directory. It
  previously tried the install directory first (falling back to temp only if that looked
  unwritable), but that writability check isn't a reliable predictor on Windows — confirmed by a
  real `EPERM` failure downloading into `Program Files` despite the check passing.

## [1.0.54] - 2026-07-08

### Fixed
- **Local Whisper models were downloading (or trying to) into the wrong place, causing an
  "ENOTDIR" crash and models appearing to re-download every time.** `@huggingface/transformers`
  caches models under its own node_modules folder by default, which on a per-machine Windows
  install lives under Program Files - not writable by a normal user. Models now download into
  `<userData>/models/whisper/<repo>/<model>/...` instead, which is always writable and easy to
  find. Verified live: files land in exactly that structure, and re-running with the same model
  loads from disk with no network access at all (the file's timestamp doesn't change).
- **OCR screen-translate failed to start ("worker script...must be an absolute path")** — same
  root cause as an earlier ffmpeg fix this session: tesseract.js computes its worker script path
  via its own internal `__dirname`, which resolves to a path inside `app.asar` in a packaged
  build, and `worker_threads` can't load a script from inside an asar archive at all (unlike
  `require()`/`fs`, which Electron does transparently redirect). tesseract.js is unpacked from
  the asar already; now the worker path is explicitly patched to point at that unpacked copy.
  Verified by actually creating and tearing down a real tesseract worker with the fix applied.
- **Auto-rejoin ("crash recovery") treated a normal VRChat close as a crash.** It only checked
  whether VRChat.exe was still running - true for an actual crash AND for closing the game
  normally, so it couldn't tell them apart. It now only rejoins when Windows' own crash reporter
  (WER) has actually logged an "Application Error" event for VRChat.exe around the time it
  disappeared - a real crash (unhandled exception, access violation, etc.) always generates one,
  a normal quit never does. This was cross-checked against 26 real historical VRChat logs: none
  contained an actual engine/native crash dump (the "abrupt-looking" ones were just routine,
  non-fatal in-world Udon script exceptions), and VRChat's own clean-quit log marker only
  appeared in fewer than half of them - confirming that "the log doesn't end cleanly" alone
  would have kept false-positiving the way this bug report described.

## [1.0.53] - 2026-07-08

### Added
- **Standalone updater app** (`updater/`) — a small, separate Electron app with its own branded,
  animated UI (glowing/floating logo, shimmering progress bar) that owns the whole update
  experience: downloading the new release with a real progress bar, installing it, and
  relaunching KitsuNexus. It has to live outside the main app's own files, since it's the thing
  replacing them — packaged as a standalone `updater.exe` on Windows (a portable single-file
  build, no separate install step of its own), bundled inside the app on Mac/Linux. It's built
  fresh by CI for each platform and bundled directly into **both** the NSIS `Setup.exe` and the
  `.msi` installers, so it's always present after any install.
- **Cross-platform update support**: Windows runs the downloaded `.msi` via `msiexec` (fully
  verified — built, launched, and run through its real download→install-attempt flow in this
  session); Mac extracts the release `.zip` and swaps it in for the existing `.app` bundle; Linux
  replaces an AppImage in place, or hands a `.deb` to the desktop's own package-install UI since
  that needs root this helper can't safely provide unattended. **The Mac and Linux paths are
  implemented from documented platform behavior but have not been run on a real Mac or Linux
  machine** — flagging that honestly rather than claiming untested code as verified.

### Changed
- **The installer is no longer silent.** Earlier in this version's development it ran with
  `/passive` (a bare progress bar, easy to miss) — now the standalone updater's own window makes
  clear that an update is actively happening from download through relaunch.
- Reworked the whole update pipeline: the main app no longer downloads anything itself: it just
  hands the release asset URL to the standalone updater and quits.

### Fixed
- A bug in the standalone updater's "wait for the main app to fully exit" logic that could hang
  indefinitely if ever given PID 0 (a special value meaning "current process group" to
  `process.kill`, not a real caller PID) — found via direct testing, not just review.

## [1.0.52] - 2026-07-08

### Added
- **Voice assistant: time in other regions/timezones.** "What time is it in Eastern Time?"
  now actually answers for that region instead of always giving local time. The AI provider
  resolves the place to a real IANA timezone itself; a built-in alias table covering common
  USA/Canada/EU/Asia names (Eastern/Pacific/Mountain, Toronto/Vancouver, UK/EU/Germany/Greece,
  Japan/China/India/Singapore/Dubai, etc.) acts as a deterministic fallback for weaker/local
  models that don't reliably produce IANA names. Genuinely ambiguous regions ("Asia" alone spans
  ~9 time zones) get a clarifying question instead of a guess.
- **More local Whisper models: Medium, Large v3, and Large v3 Turbo** (OpenAI's own ~8x-faster
  distilled variant of Large v3 — this is "faster whisper" without needing a separate native
  runtime). Downloads happen automatically the first time a model is actually selected and used
  (never eagerly), with a real progress bar since the larger ones are multi-gigabyte; a model
  that's already been downloaded loads straight from cache.
- **Local Whisper now uses your GPU automatically, falling back to CPU** if none is available or
  usable (confirmed via a real DirectML pipeline creation, not just a device-name guess).
- **Voice assistant: "mic sensitivity" setting** (quiet room / normal / noisy room), and the
  minimum listen time now dynamically extends while you're still talking (up to 15s), only
  cutting off after a real pause — a 10-second command no longer gets truncated.

### Fixed
- **Voice assistant kept hearing "you" out of nowhere and burning through the cloud
  speech-to-text rate limit.** It was transcribing every listen cycle unconditionally, including
  ones that were just silence/room noise — which is exactly when Whisper is known to hallucinate
  short stock phrases like "you". Near-silent clips are now skipped before they're ever sent to
  transcription at all (fixes both the false "heard" spam and the wasted API quota), and a small
  filter catches the handful of known Whisper hallucination phrases as a second layer.
- Local Whisper's automatic GPU selection could crash outright ("DML EP can only be used with CPU
  EPs") because the library's own 'auto'/'gpu' device resolution mixes in a WebGPU provider that
  isn't actually usable from the main process. Fixed by picking the platform-appropriate GPU
  device explicitly (DirectML on Windows, CUDA on Linux, CoreML on Mac) with a real fallback to
  CPU if that fails to initialize.

## [1.0.51] - 2026-07-08

### Added
- **In-app update installs.** The "Update available" dialog no longer just opens a browser link
  for you to download and run manually — clicking "Download & install" now downloads the
  release's .msi directly (saved next to the current install, falling back to a temp folder if
  that location needs admin rights to write to), shows real download progress, then closes the
  app and runs the installer for you, relaunching KitsuNexus automatically once it's done. If a
  release doesn't have an .msi asset, it falls back to the old open-in-browser behavior.

## [1.0.50] - 2026-07-08

### Added
- **Voice assistant: "what time is it" / "what's the date today".** Answered directly from the
  system clock (a language model has no real way to know the actual current time), not sent to
  the AI provider or web search.

### Fixed
- **SOS instant-replay clips came out solid black.** The previous fix that made replay capture
  auto-prefer the actual VRChat *window* (over the whole screen) backfired: Chromium's
  window-level capture on Windows uses GDI/BitBlt, which can't see hardware-accelerated
  DirectX/Vulkan swapchain content and returns solid black for exactly the kind of window a game
  renders into. Reverted to capturing the whole screen, which goes through the Desktop
  Duplication API and correctly captures whatever the GPU actually drew. If VRChat runs on a
  second monitor, use the manual capture-source picker in Settings to choose that screen.

## [1.0.49] - 2026-07-08

### Changed
- **SOS instant-replay recording is now hardware-encoded (mp4/h264) instead of software-encoded
  (webm/vp8)**, on systems where Chromium exposes a hardware mp4 encoder (Windows via Media
  Foundation - the normal case). This offloads the *entire* background recording, not just the
  final export, off the CPU. Falls back to webm automatically if no hardware encoder is exposed.
- **Saving a clip no longer re-encodes with libx264 when it doesn't need to.** Previously every
  clip was fully re-encoded through software libx264 regardless of source codec, which is what
  was showing multiple `ffmpeg.exe` processes at very high CPU/GPU usage. Segments that are
  already mp4/h264+aac are now just stream-copied (remuxed) into the final file - effectively
  free, no re-encoding.
- **When a real transcode genuinely is needed** (older systems without a hardware mp4 recorder,
  or the rare stream-copy that doesn't line up), it now auto-detects and prefers a GPU encoder -
  NVENC (Nvidia), then Quick Sync (Intel), then AMF (AMD), each confirmed with a real throwaway
  encode rather than just a name check - before falling back to CPU (libx264) only if none of
  those are actually usable on this machine.

## [1.0.48] - 2026-07-08

### Added
- **Voice assistant is now also a VRChat world-creation brainstorming partner and a general,
  Alexa-like assistant** — weather, news/current events, general questions, small talk — while
  explicitly declining to help write, debug, or explain code.
- **Web search for the voice assistant**, user-selectable: a self-hosted **SearXNG** instance
  (JSON API) or **DuckDuckGo's** no-key Instant Answer API (limited — often returns nothing for
  ordinary queries, offered as a no-setup fallback). Used for "what's the weather", "what's the
  news", and anything else current/factual.

### Changed
- **The voice assistant never posts to the VRChat chatbox anymore.** Every response is spoken
  via TTS only.
- **SOS instant-replay clips are now real, playable .mp4 files** (previously .webm). The rolling
  buffer now rotates to a fresh self-contained recording every 10 seconds instead of pruning
  chunks from one continuous recording, and the main process stitches the kept segments together
  with a bundled ffmpeg and transcodes to H.264/AAC.
- **Screen-capture features (SOS instant-replay, OCR, Desktop STT, OSCQR/Shazam) now auto-prefer
  the actual VRChat window** instead of defaulting to the whole primary screen.

### Fixed
- **SOS instant-replay clips were corrupted/unplayable.** Root cause: pruning old chunks off a
  single continuous recording eventually dropped the one chunk holding the file's container
  header, so exported clips had no valid header at all (a static/garbage frame in most players).
  Fixed by the segment-rotation rework above — verified end-to-end with a generated test clip
  that now decodes cleanly.
- **Avatar Scaling's hotkey recorder gave no reason when it failed ("hotkey broken, doesn't
  save").** If the underlying keyboard-hook process couldn't actually start (blocked by
  antivirus, a restrictive PowerShell execution policy, etc.), "Record" silently sat until an 8s
  timeout with the same generic "no key captured" message, indistinguishable from just not
  pressing anything in time — and since nothing was ever captured, nothing was ever saved. It now
  surfaces the real reason after a 2.5s health check instead.

## [1.0.47] - 2026-07-08

### Fixed
- **Voice assistant's "who's online" always said nobody was, even when friends were.** It was
  calling the VRChat API method whose friend objects never carry an `online` flag at all (that
  flag only exists on the *reconciled* all-friends call, which fetches the online and offline
  buckets separately and tags each). Every friend's `online` was `undefined`, so the online
  filter was always empty. Switched to the reconciled call; verified against the real API
  response shape.

## [1.0.46] - 2026-07-08

### Fixed
- **Avatar Scaling's scale reset to 1.00m on every restart** — it was never saved at all,
  only its enable/safety/smoothing/hotkey settings were. Now saves (debounced) and restores on
  boot. Also fixed the "Safety limits" checkbox silently defaulting to *off* on a fresh install
  despite showing checked in the UI.
- **Audited settings persistence across the whole app** after the above — cross-referenced all
  249 input/select/textarea fields against what actually gets saved/restored. Found and fixed
  two more real gaps: the VR gear battery toggle had no persistence at all (same bug pattern as
  Avatar Scaling), and Rusk Laserdome / Twitch Interactive fields only saved when you clicked
  Start, losing any edit made while already running. Everything else checked out as either
  already persisting correctly through a generic save, or intentionally transient (search
  boxes, one-off action parameters, live faders, credential fields that save on Connect).

## [1.0.45] - 2026-07-08

### Fixed
- **"Sorry, I couldn't reach my brain just now" gave no way to diagnose the problem.** The
  voice assistant's command-interpretation call was swallowing the real HTTP error and always
  showing the same generic message. Now shows the actual cause (bad API key, connection
  refused, etc.) directly in the reply, and validates upfront that an AI provider is configured
  at all before starting to listen, instead of only finding out on the first spoken command.

## [1.0.44] - 2026-07-08

### Fixed
- **Voice assistant was listening to the wrong audio source.** It used desktop/system-audio
  capture (`getDisplayMedia`, what's playing through your speakers) for the wake-word loop, so
  it could never hear you speak no matter which microphone was selected elsewhere. Now listens
  through an actual microphone with its own selectable input device. The instant-replay
  screen-capture used for SOS clips is now a separate, opt-in checkbox instead of sharing the
  same (wrong) stream.
- **TikTok TTS had no voice picker** in the unified Text-to-Speech card — always used the
  hardcoded default voice. Added a voice select (same list as before), and removed the old
  now-redundant standalone "TikTok TTS" card.

## [1.0.43] - 2026-07-08

### Added
- **SOS clips are now saved locally** to `Videos/KitsuNexus/` (folder created automatically
  if it doesn't exist), independent of whether a Discord webhook is configured for sharing them
  with trusted friends — the clip is never lost to a missing/failed upload.

### Fixed
- **Voice assistant silently not responding.** The most common cause: the cloud speech-to-text
  engine was selected with no API key ever entered, so every clip failed transcription with a
  generic error indistinguishable from "the wake word didn't match." Starting the assistant now
  validates this upfront and fails immediately with a clear, specific message. The status line
  also now shows the actual configured wake word, and shows what was transcribed even when it
  doesn't match the wake word, making it obvious whether speech is being heard at all.

## [1.0.42] - 2026-07-07

### Added
- **11 more TTS engines**, ported from [TTS-Voice-Wizard](https://github.com/VRCWizard/TTS-Voice-Wizard)
  for feature parity: OpenAI TTS, Google Cloud TTS, Azure Cognitive Speech, Amazon Polly, IBM
  Watson TTS, Deepgram Aura, VoiceForge, UberDuck, TTS Monster, GLaDOS TTS (self-hosted), and
  Moonbase Voices (self-hosted local app) — 15 engines total now selectable in the Translation
  tab. Where the reference project proxies an engine through its own paid backend (Google, IBM
  Watson, Deepgram), this calls the real vendor API directly with your own credentials instead.

### Fixed
- **TikTok TTS was broken** (its one hardcoded community proxy had gone down). Now tries a
  short list of known-working proxies in order and checks every response field name different
  proxies use, instead of just one.
- **Packaged-build crash**: "Could not start screen capture — worker script... must be an
  absolute path" (OCR), and local Whisper would have hit the same class of failure. Added
  `build.asarUnpack` for `tesseract.js`/`tesseract.js-core` (worker_threads script) and
  `@huggingface/transformers`'s native-binary dependencies (`onnxruntime-node`, `sharp`) — none
  of those can load from inside an asar archive. Only reproduces in an installed build, not
  `npm start`.

## [1.0.41] - 2026-07-07

### Added
- **Avatar Scaling.** New OSC card using VRChat's native `/avatar/eyeheight*` height-scaling
  API — works on any avatar, no exposed avatar parameters needed. Safety limits, save-scale-
  between-worlds, smoothing, and global hold-to-scale hotkeys (via a PowerShell
  `System.Speech`/`WH_KEYBOARD_LL`-style hook, no bundled native binary).
- **Translator.** New Settings card — DeepL, Google Translate, LibreTranslate (including a
  ready-to-use NekoSuneVR-hosted instance), and MyMemory (no key needed), with an optional
  "fix grammar with AI first" pass through the existing IntelliChat provider.
- **Live Typing chatbox.** Sends as you type (throttled), shows VRChat's real 144-char
  overflow behavior ("…" + tail) live, with an optional translate-before-send toggle.
- **Localization.** Full i18n foundation — first-run language picker, live language switching
  (no restart), 102 seeded languages. Covers the sidebar nav, common buttons, and all new UI
  added this release; broader legacy-string coverage is ongoing.
- **Desktop speech-to-text.** Listens to shared desktop/system audio and transcribes it, both
  cloud (OpenAI/Groq Whisper) and fully local/offline (WASM Whisper), feeding into the
  Translator and chatbox/TTS.
- **OCR screen-translate.** Reads on-screen text from a shared window (e.g. VRChat) and
  translates it to chatbox.
- **Text-to-speech**, four selectable engines: Windows built-in (SAPI), TikTok TTS, ElevenLabs
  (cloud), and self-hosted (Piper/XTTS/other), plus an output-device picker.
- **Voice assistant.** Wake-word activated ("Nova" by default, customizable) — ask about a
  friend's online status and world, who's online, your own status, or change your status text
  (never the bio). Manual-only SOS (spoken command or button) invites a configured trusted-
  friends list and shares a rolling instant-replay clip (1/5/10 min) via a Discord webhook.
  Includes a soft, text-based emotional check-in that only ever asks if you're okay — it never
  auto-triggers anything.

### Fixed
- **KAT (KillFrenzy AvatarText) sync-param auto-detection.** Previously under-detected sync
  params (e.g. reporting 4 on a 16-param avatar) because the probe reset before VRChat's
  throttled OSC echoes had a chance to arrive. Now holds the probe for longer and also checks
  VRChat's own avatar OSC config file directly. Added a manual override as a fallback.

## [1.0.40] - 2026-07-07

### Added
- **Customizable media progress tokens.** Status presets can now include Now Playing
  timestamp/progress values, and `{songbar}` supports selectable styles — bars, stars,
  diamonds, dots, squares, and thin blocks.

## [1.0.39] - 2026-07-07

### Fixed
- **Weather chatbox token.** `{weather}` is now exposed in the chatbox token map and formats
  without the location prefix, while the Weather page itself still shows the location.

## [1.0.38] - 2026-07-07

### Added
- **Translation page.** Dedicated sidebar page for the Translator, IntelliChat AI provider,
  and TikTok TTS voice test cards, with hosted (NekoSuneVR) and custom translation-endpoint
  defaults plus a NekoSuneVR Ollama preset.
- **Expanded avatar search providers.** Added VRCX vrcdb, Paw API VRCX, NekoSuneVR Avatar
  Search, avtr.zip VRCX, avtrdb VRCX, and WorldBalancer VRCX as selectable/default providers,
  with a more flexible response parser (handles more field-name variants, `items` arrays, and
  now carries a `performance` rating through).
- **Multi-client OSC send/receive.** KAT and Avatar Scaling (and Discord Rich Presence OSC)
  can mirror to extra OSC targets, not just the primary send port.
- **KAT avatar-config detection.** In addition to probing, KAT now reads VRChat's own per-
  avatar OSC config JSON directly to detect the exact sync-param count when available.
- **Notification history / archive.** Removed, resolved, and cleared notifications are now
  archived to a `notification_history` table instead of just being deleted, and the
  notification list can be reconciled against the currently-active set.

### Changed
- **Avatar Scaling range improvements.**
- **TikTok follower tracking auto-start.**
- Moved ToN Tablet OSC and Emerald Sound System into the Terrors page; updated README feature
  coverage.

## [1.0.37] - 2026-07-07

### Changed
- **Sidebar icon manifest.** Documented the current icon set, moved Ranks/About into their
  live tab positions, and marked the old `osccontrol` icon as legacy/unused.

## [1.0.36] - 2026-07-07

### Added
- **Localization foundation.** i18n locale loading, a first-run/Settings language picker, and
  the first batch of seeded locales (coverage still ongoing at this point).
- **Translator provider settings** and **Live Typing chatbox** support.
- **Avatar Scaling** with global hotkeys.
- **KAT sync-parameter controls** (manual override alongside auto-detect).

## [1.0.35] - 2026-07-01

### Added
- **User-selectable theme picker.** New "🎨 Theme" card in Settings with a dropdown
  covering every theme (Auto, Black & Green, Black & Purple, Black & Pink, Black &
  Cyan, Black & Gold, Midnight, Dark, Neon, Pink, Green, Rainbow, Light). The choice
  is saved and re-applied live without a restart.
- **Four new "black & ___" themes.** Black & Purple, Black & Pink, Black & Cyan, and
  Black & Gold — modern near-black backgrounds with a single accent color.

### Changed
- **New default theme: Black & Green.** Replaces the old bright/saturated green that
  was previously hardcoded as the year-round default outside holiday windows.
- **Seasonal event themes now override any custom theme pick.** Halloween, Christmas,
  Pride, and Easter always take over during their date window even if you've picked a
  specific theme, then your pick automatically resumes once the event ends. Previously
  themes were either fully seasonal or (with the new picker) fully manual; now the two
  compose. Re-checks every 30 minutes so a window opening/closing mid-session still
  recolors without a restart.

## [1.0.34] - 2026-06-29

### Added
- **Integrated NekoAvatarLocker.** A new sidebar page imports and verifies signed
  `.nalown` ownership packages, keeps them in an encrypted AppData vault, migrates an
  existing NekoAvatarLocker desktop vault, exports packages, signs creator templates,
  and sends Locked/Partial/Unlocked plus per-feature group states to VRChat over OSC.
  Creator private keys and unrelated Android/Unity/build files are never bundled.
- **Avatar Locker sidebar artwork.** Added a matching white transparent lock-and-avatar
  icon generated for the existing navigation icon style.
- **OAuth Accounts sidebar.** Twitch Client ID, optional secret, channel, redirect URL,
  login and token management now have one shared page used by follower tracking and
  Twitch Interactive. The provider layout is ready for additional OAuth services.
- **OSC Apps hub.** Added an extensible sidebar page for avatar compatibility tools,
  starting with Rusk Laserdome OSC and native avatar integrations.
- **Native Rusk Laserdome compatibility.** An attributed MIT-licensed port tails new
  VRChat log data and restores `LD/Dead`, `LD/Team`, IR pickup, Duo weapon, Avi weapon,
  and UASRF weapon OSC parameters with individual feature toggles and optional backlog scan.
- **Twitch Interactive compatibility.** Twitch chat commands and channel-point reward
  redemptions can map to the single `twitch` integer used by Fooma's Twitch to VRChat
  Interaction System. Mappings, pulse duration and parameter name are saved locally,
  and the bridge resumes in the background when enabled.
- **OSC Realistic Leash compatibility.** Added native eight-direction movement for
  `MOF/MOB/MOL/MOR` and diagonal `MOFL/MOFR/MOBL/MOBR`, immediate release through
  uppercase `STOP`, plus `Jump`, backward `JumpS`, and leftward `JumpA`. Undocumented
  `JumpQ` is safely ignored by default with optional jump/forward/right mappings.
- **OSC Digital Clock compatibility.** Added a background sender for `OSCClock/MonthF`,
  `DayF`, `HourF`, `MinuteF`, and `DOWF`, preserving the original app's five-decimal
  `/127` float encoding and optional legacy `DoWF` weekday spelling.
- **Native OSCQR.** Added user-approved live screen/window capture, QR detection through
  `jsQR`, Spotify-link classification, AppData history, optional chatbox output, and
  compatible `OSCQR/*` triggers/status parameters.
- **Native ShazamOSC-style song recognition.** Added desktop system-audio capture,
  user-token AudD recognition, optional 25-second live mode, low-frequency bass output,
  match history and links, chatbox output, and compatible `ShazamOSC/*` parameters.

- **Extensible BLE heart-rate platform adapters.** Bluetooth SIG parsing and the
  Goodmans/FunDo protocol now live in separate `devices/ble/platforms` modules. The small
  `devices/ble/index.js` registry supplies one service list, platform detection, and a
  normalized BPM relay, with an adapter contract README for adding more watches.
- **Tidier Heart Rate layout.** Provider credentials, BLE/local devices, background
  behavior, Pulsoid forwarding, live BPM, and session history are grouped into responsive
  panels instead of one long settings column.
- **Beko Smooth Heartbeat / VRC Heart Rate OSC profile.** Every heart-rate source can now
  publish the current VRCOSC `Connected`, `Value`, `Normalised`, `Average`, and `Beat`
  parameters plus its legacy digit floats. An optional `HR` integer supports the older
  2.x Beko prefab without overwriting its internal `HBG/*` menu and audio controls.
- **Akaryu HeartRate OSC 3.0 profile.** Added `hr_percent`, `hr_connected`, and calculated
  `hr_beat` output with a configurable maximum BPM, while leaving the asset's local UI,
  placement, scale and opacity parameters under avatar-menu control.
- **Separate Pulsoid read and posting tokens.** OAuth now requests only
  `data:heart_rate:read`. Device relay has an independent manual posting-token field
  for `data:heart_rate:write`; tokens are never copied between the two.
- **Bluetooth LE heart-rate scanner.** The local-device provider can discover nearby
  BLE watches and monitors, show previously granted devices, handle pairing prompts,
  connect/reconnect over GATT, and stream the standard Bluetooth Heart Rate Service
  into the existing OSC, Discord, analytics, and optional Pulsoid relay pipeline.
  Includes a built-in **GMANS WATCH** adapter using its proprietary notification and
  measurement-trigger protocol.
- **Persistent BLE reconnect and diagnostics.** Selected watch IDs/names are cached in
  AppData and used to reacquire remembered devices. GATT setup now performs three clean
  retries, unexpected disconnects back off and reconnect in the background, and a
  watchdog restarts sessions that stop producing BPM. A rotating local debug log records
  discovery, pairing, GATT errors, GMANS frames, measurement triggers, and connection state.
- **GMANS raw-frame-aware watchdog.** Proprietary `AC` optical-sensor frames now count
  as connection activity, so the watchdog no longer resets a healthy GATT session while
  waiting for an `AB` BPM result. Zero optical samples get a clear wear/watch-mode hint,
  and pressing Connect again no longer restarts an already connected watch.
- **GMANS screen-off sensor wake fallback.** When the watch stays connected but returns
  repeated zero-value optical frames, the app can replay the captured official-app
  `FF00` connect handshake in BLE-sized fragments and retry the `A6` measurement command,
  aiming to start measurement without leaving the watch Heart Rate screen open.
  The wake is scheduled from the first zero-signal frame instead of waiting for several
  frames, since this firmware may emit asleep-state `AC` frames only every 30 seconds.
  Further captures show the `FF00` payload changes per connection, so this experimental
  replay is now disabled by default rather than presenting it as a reliable wake method.
- **GMANS firmware automatic heart-rate mode.** Reverse engineering the Goodmans Fit Pro
  APK exposed its FunDo/KCT `setAutoHeartData` (`09/92`) command. The device page can now
  enable all-day watch-side measurements at a configurable interval, save that choice in
  AppData, and restore it after reconnect. This works without leaving the watch Heart Rate
  screen open, although firmware may deliver periodic/history samples rather than a
  continuous live stream.
- **Generic heart-rate device bridge.** Unsupported watches and device adapters can
  now feed BPM directly into KitsuNexus through a loopback-only HTTP receiver.
  Common BPM JSON shapes and simple query-string input are accepted, and readings
  can optionally be forwarded to Pulsoid using a write-scoped token.
- **Configurable Pulsoid authorization.** The Heart Rate page uses Pulsoid's desktop
  Device Authorization Flow for read access and saves the resulting read token.
  It needs no redirect URI or client secret. The client ID and read scope live in one
  `providers/pulsoid/pulsoid.config.json` file.

### Changed
- **SpotiOSC and DiscordOSC moved into OSC Apps.** Their controls now sit beside the
  other OSC integrations, and the redundant standalone OSC Control sidebar page has
  been removed. The ToN Tablet refresh hook now correctly follows its Tools page.
- **Broader VRCOSC avatar compatibility.** Media now accepts `VRCOSC/Media/Play`,
  `Skip`/`Next`, and `Previous`; Discord accepts `VRCOSC/Discord/Mic` and publishes the
  Yeusepe DiscordOSC metadata flag. Digital Clock can also send normalized
  `VRCOSC/Clock/Hours` and `Minutes` floats plus raw `DateTime*` integer fields.
- **Expanded native SpotiOSC and DiscordOSC.** The separate OSC Apps cards now publish
  Windows media playback position/state, track-change events, Discord bot readiness,
  mute/deafen, voice user count and connection state. Spotify Jam invite links can be
  opened or created through Spotify's own UI.
- **Tidier integration source layout.** Reorganized the former flat integrations folder
  into documented `osc`, `ton`, `discord`, `media`, and `maintenance` areas.
  OSC features have individual QR, recognition, clock, leash and Laserdome folders, and
  every ToN file—including `tonOsc.js`—now lives together.
- **Consolidated Twitch and heart-rate layouts.** Twitch runtime features now live under
  `live/twitch`, reusable authorization lives under `oauth/providers`, and heart-rate code
  is grouped into `core`, `providers`, `devices`, and `osc` folders with contributor READMEs.
- **Pluggable song-recognition providers.** Replaced the hand-written AudD multipart
  client with the official MIT `@audd/sdk`, added the MIT ACRCloud client as a credentialed
  option/fallback, and added detection for an externally installed `node-shazam`. The
  GPL-2.0 node-shazam package is deliberately not redistributed by KitsuNexus.

## [1.0.33] - 2026-06-29

### Fixed
- **Sidebar nav buttons and launch button appeared squashed/oval after the
  1.0.32 layout fix.** Changing the app to `height: 100vh` gave the sidebar
  flex container a constrained height, causing CSS flex-shrink to compress items
  (buttons are not explicitly `flex-shrink: 0`). Added `.sidebar > * { flex-shrink: 0 }`
  so all children keep their declared size; the `flex:1` spacer (inline style)
  retains `flex-shrink: 1` and collapses first, then the sidebar scrolls.
- **User profile picture not appearing anywhere in the app.** `pickUser()` in
  `vrchatApi.js` was not including the `userIcon` / `profilePicOverride` /
  `currentAvatarThumbnailImageUrl` fields, so every avatar slot fell through to
  the fallback app logo. Added `userIcon` to `pickUser()` using the same
  priority order as the friends list renderer.

### Added
- **Your VRChat profile picture now shows at the bottom of the sidebar.** A small
  circular avatar appears above the clock rail once you are logged into VRChat.
  Clicking it opens your full profile card (same as clicking your profile in the
  right panel). It updates alongside the rest of the rightbar every 120 seconds.

## [1.0.32] - 2026-06-29

### Fixed
- **Sidebar scrolled off-screen when the main content area was tall.** The app
  layout used `min-height: 100vh` so the entire page could grow and scroll as one
  unit, pushing the sidebar out of view. Changed to a fixed `height: 100vh` layout
  with `overflow: hidden` on the body so the sidebar and main panel each scroll
  independently and the sidebar stays pinned at all times.
- **Sidebar button tooltips were invisible.** Tooltip labels were rendered as
  `position: absolute` children inside the sidebar, but the CSS spec forces
  `overflow-x` to `auto` whenever `overflow-y` is non-`visible`, so the sidebar
  clipped them silently. Replaced with a JavaScript tooltip that appends to `body`
  and uses `position: fixed`, so it appears correctly beside any button regardless
  of the sidebar's overflow setting.

### Added
- **Sidebar tooltips.** Hovering any nav button now shows a floating label with
  the button's name (e.g. "Friend Den", "History", "OSC Control"). The tooltip
  uses a body-level fixed element so it is never clipped by the sidebar.

## [1.0.31] - 2026-06-29

### Fixed
- **Discord Rich Presence staying blue after a VRChat status change.** The
  profile update handler never notified Discord — it relied on the 60-second
  poll, so RPC stayed stale until the next cycle. Now immediately calls
  `setVrcContext()` with the new mapped status as soon as the update succeeds.
- **Saving your profile wiped your VRChat bio.** `pickUser()` never included
  the `bio` field, so the profile editor textarea was always empty on load.
  Clicking Save then sent `bio: ""` to VRChat, clearing it silently. Fixed by
  including `bio` in the user object and blocking Save if the profile hasn't
  been loaded first.
- **Friend Den showing friends as unfriended and re-friended repeatedly.** The friend
  diff tracker was using VRChat's raw paginated API buckets, which silently drop friends
  mid-transition between online and offline states, causing false unfriend/refriend
  events to appear in History. The tracker now uses `getAllFriends()`, which reconciles
  against the authoritative `auth/user.friends` ID array so the list is stable and
  complete. The cache is also invalidated before each poll to guarantee fresh data.

### Added
- **Friend Den shows your real total friend count.** The count pill (e.g. `12/247`)
  now uses the authoritative total from your VRChat account instead of however many
  friends happened to load from the paginated API.
- **Sidebar is now drag-and-drop reorderable.** All nav buttons in the left lane can
  be dragged up or down to rearrange them. The order saves automatically and is
  restored on the next launch. Category labels, the clock, and other non-button
  elements stay fixed in place.

## [1.0.30] - 2026-06-18

### Fixed
- **Installer build was broken.** The packaging config pulled the `dist/` output and
  `.git/` folder back into the app bundle, inflating `app.asar` past 2 GB and failing
  the MSI build. The build now excludes `dist/`, `build-out/`, and `.git/`, producing
  much smaller installers. (No app behavior change from 1.0.29.)

## [1.0.29] - 2026-06-18

### Changed
- **Manual chatbox messages now stay pinned.** Sending a message from
  **💬 Send to VRChat chatbox** pins it for **1 minute 30 seconds** (overriding the
  automated rotation), then the chatbox returns to automated status. A live status
  line shows the countdown.

### Added
- **Chatbox message history.** A new **🕘 Message history** card lists your sent
  messages with a **↻ Repost** button (re-pin without retyping), per-entry delete,
  and **paging** (8 per page). History is persisted across app restarts.

## [1.0.28] - 2026-06-17

### Added
- **Heart rate avatar OSC parameters.** The heart-rate monitor now drives a set of
  avatar parameters over OSC (configured port, default 9000):
  - `HeartEchoes_Heart_Beat` (**int**) — live BPM.
  - `isHRActive` (**bool**) — true while monitoring is turned on.
  - `isHRConnected` (**bool**) — true when the provider (Pulsoid / HypeRate) has a live reading.
  - `isHRBeat` (**bool**) — pulses true briefly on each beat, timed from the current BPM.
  - `HeartBeatToggle` (**bool**) — flips state on each beat (for alternating animations).
  All reset to 0/false when monitoring stops or the connection drops.

## [1.0.27] - 2026-06-14

### Fixed
- **Component stats showing 0% for everything.** CPU and RAM are now read natively
  from Node's `os` module (CPU via load deltas, RAM via total/free) instead of relying
  on `systeminformation`'s WMI/PowerShell, which returns 0 on some locked-down / VM /
  broken-perf-counter PCs. systeminformation is still used (with the native value as a
  fallback) for the extras — CPU temp, GPU load/temp, VRAM.
- **Status presets / bio prefabs wouldn't save.** The "Save current" buttons used
  `window.prompt`, which Electron doesn't support (it silently returned null), so
  nothing was saved. Added a proper in-app prompt dialog; naming and saving works now.

## [1.0.26] - 2026-06-14

### Fixed
- **Now Playing not detecting on some PCs.** Two root causes addressed: the detector's
  5s timeout was too short for slower PCs' WinRT/PowerShell cold start (raised to 9s),
  and it effectively only surfaced a session when something was actively **Playing** —
  paused tracks now detect too. The card also shows the real reason when it fails
  (timeout / PowerShell blocked / no registered media apps) instead of a blank
  "No active session".

### Added
- **Media source dropdown.** Pick which app Now Playing follows (Auto by default) —
  fixes cases where someone else's audio/another app was being picked instead of
  Spotify. Lists every media session Windows reports, with status, and remembers your
  choice. Works on Windows 10 (1809+) and 11.

## [1.0.25] - 2026-06-14

### Added
- **ToN Tablet OSC now also drives Gridring** (pluslatte Grid_Ring_2). Added the
  `ToN_IsStarted` (round started) parameter; `ToN_RoundType` was already shared by
  name, so the one proxy now drives both the Terror Tablet and Gridring at once.

## [1.0.24] - 2026-06-14

### Added
- **ToN Tablet OSC proxy.** Forwards the core ToNSaveManager state the app already
  tracks (round type, terror, map, item, alive/opted-in/saboteur) to the avatar's
  `ToN_` parameters over OSC, so the Terror Tablet works driven by KitsuNexus.
  Numeric ids are forwarded raw from the WebSocket; ToNSaveManager still drives the
  full 134-float terror-grid buffer. Includes a **"Show raw WS"** debug view to verify
  the id mappings in-game. Toggle under OSC Control → ToN Tablet OSC.
- **Emerald Sound System (rf_ESS) controls.** Audio-reactive `rf_ESS/Float` (follows
  AudioLink volume) plus manual toggle buttons for `rf_ESS/Global/Have/Less/Set/Toggle`
  and a manual Float slider. Under OSC Control → Emerald Sound System.

## [1.0.23] - 2026-06-14

### Added
- **Window activity: "Show full window title" toggle.** The chatbox window line can
  now show the full window title (e.g. "renderer.js - KitsuNexus - Visual Studio
  Code") instead of just the app name ("Code"). Off by default; toggle under Window
  activity. Long titles are truncated so they fit the 144-char chatbox.

## [1.0.22] - 2026-06-14

### Added
- **Sidebar icons for the Community Ranks and About tabs** (`ranks.png`, `about.png`,
  256×256 transparent PNGs matching the existing set) — they now replace the 🏅/ℹ️
  emoji in the sidebar. The full icon set is complete.

## [1.0.21] - 2026-06-14

### Added
- **Overlay box background toggle (Solid / Thin / Hidden).** The OBS now-playing
  overlay can now thin or fully hide the box behind the card (text-only, with shadows
  for legibility) — per style, with a `?bg=solid|thin|hidden` URL override too. Note:
  this is the **OBS overlay**, not VRChat's in-game chatbox — VRChat renders the
  chatbox itself and exposes no OSC control over its background.
- Documented the two missing sidebar icons (`ranks.png`, `about.png`) in
  `assets/icons/README.md` for generation.

## [1.0.20] - 2026-06-14

### Changed
- **Trust ranks now mirror VRChat exactly (like the OGTrustRanks mod).** That mod
  doesn't compute ranks itself — it calls VRChat's still-present internal
  `APIUser.GetTrustRankEnum()` / `GetFriendlyDetailedNameForSocialRank()`, which keep
  producing Veteran & Legend (VRChat only hid the display). Those are driven by trust
  tags, so we map them the same way:
  `system_trust_legend` → **Legend**, `system_trust_veteran` → **Veteran**,
  `system_trust_trusted` → Trusted User, `system_trust_known` → Known User,
  `system_trust_basic` → User. Reverted the 1.0.19 join-year gating — `system_trust_veteran`
  genuinely IS the OG Veteran tier (so it's common by design), and **Legend** is reserved
  for the grandfathered legend tag, so true legends like Shadowriver show Legend.

## [1.0.19] - 2026-06-14

### Fixed
- **Almost everyone showed as "Veteran".** VRChat's `system_trust_veteran` tag is
  just its internal name for **Trusted User** — not the old Veteran rank — so mapping
  it to Veteran promoted every trusted user. Corrected the trust mapping to real rank
  names (top trust = Trusted User). Now:
  - **Legend** comes from the grandfathered legend tag (`system_legend` /
    `system_trust_legend`), so true legends (e.g. Shadowriver) show Legend.
  - **Veteran** is reserved for top-trust accounts old enough to have actually held
    it (joined ≤ 2019), so it's rare again — newer trusted users read as Trusted User.

## [1.0.18] - 2026-06-14

### Added
- **Friends' community rank from VRChat trust.** Friends now show an estimated
  KitsuNexus Community Rank read straight from their VRChat trust tags — so anyone
  who earned it shows a **Veteran** (top trust, `system_trust_veteran`) or **Legend**
  badge. Veteran/Legend pills appear in the right sidebar; Trusted-and-up in the
  Friend Den; and the full estimated rank (plus a ✦ VRC+ supporter marker) in the
  profile modal. Honours the OG-tiers toggle (hidden tiers cap at Trusted User).
  Requires Community Ranks to be enabled.

## [1.0.17] - 2026-06-14

### Fixed
- **Sidebar friends location showed raw HTML** (e.g. `<span class="wn" data-world="wrl…`).
  The world-name span from `fmtLocation` was being double-escaped, so it rendered as
  literal text instead of resolving to the world name. The location now displays
  correctly again in the right friends list.

## [1.0.16] - 2026-06-14

### Fixed
- **Friends no longer all show as "offline".** The reconciled list was deriving
  online/offline from each friend's `state` field, which VRChat's friends endpoint
  doesn't reliably send. We now trust the API's online/offline buckets and tag each
  friend with a reliable `online` flag.

### Changed
- **Right sidebar friends are now classified VRCX-style** from `location`, not `state`:
  🟢 **Online** (in a world), 🌐 **Active** (on the website), ⚫ **Offline** — plus
  Same World and your favorite-friend **categories**. The Friend Den distinguishes
  Active vs Online the same way.

### Added
- **Community Ranks tab with the OG toggle.** A new "Community Ranks" tab exposes the
  **Enable Community Ranks** switch and the **Show OG tiers (Veteran & Legend)** toggle,
  a live rank card with the score breakdown, and a leaderboard.
- **Clickable names in History.** Player join/leave (including everyone seen in a
  world/lobby), friend add/remove, name changes and alerts now have clickable names —
  click to open that user's profile (resolved by VRChat search).
- **Previous display names on profiles.** The profile modal now shows a "Previously
  known as" list, reconstructed from the local name-change history.

## [1.0.15] - 2026-06-14

### Fixed
- **Friends list no longer drops people.** VRChat's two paginated friend buckets
  (online / offline) don't always add up to your real friend list. We now reconcile
  against the authoritative account friend-id list and individually re-fetch any
  stragglers (VRCX-style), so missing friends show up again. New `getAllFriends()`.
- The left **Friend Den** now shows your **complete** list (was online-only) with
  paging, online-first ordering, and an honest "online / total" count.

### Added
- **Spoken-language flag badges.** Friends' VRChat `language_*` tags are rendered as
  flag emoji 🇯🇵🇬🇧🇰🇷 in the Friend Den, the right sidebar, and the profile modal so
  you can tell at a glance which languages someone speaks. (50+ languages mapped.)
- The **right sidebar** now lists **all** friends per group (paging cap removed; the
  panel scrolls), using the same reconciled, complete friend list.
- **KitsuNexus Community Ranks** (opt-in) — an independent community reputation
  system that brings back the spirit of the retired Veteran / Legend ranks. Off by
  default; toggle via `communityRanks.enabled` (and `ogMode` to show/hide the OG
  tiers). 0–1000 weighted scoring, anti-farming curves, SQLite-backed, with an
  optional REST surface. See `docs/community-ranks-spec.md`.

## [1.0.14] - 2026-06-13

### Fixed
- **Update dialog now renders Markdown.** The "Update available" release notes were
  showing raw `### Added`, `**bold**` and `` `code` `` text. Added a lightweight
  Markdown renderer (headings, bold, inline code, lists, links, dividers) so the notes
  display formatted, and raised the notes length so they're not cut off mid-section.

## [1.0.13] - 2026-06-13

### Added
- **Terrors of Nowhere works without ToNSaveManager.** A new log reader
  (`tonLogReader.js`) tails VRChat's own output log and parses ToN's lines directly —
  **save codes** (`[START]…[END]`), **round type + map** (`This round is taking place
  at …`), **terror IDs**, **deaths**, **round end**, **stuns** and **damage**. Verified
  against a real log: 16 rounds, 12 save codes, deaths/survivals/stuns all parsed.
- **Achievements auto-update from captured saves.** Every save code captured (from the
  log *or* ToNSaveManager) is auto-decoded and the unlocked achievements are marked on
  the board — so your achievements stay current with no manual steps and no
  ToNSaveManager. (ToN doesn't log achievements individually; the save code is the
  source, and we decode it.)

### Changed
- ToNSaveManager is now genuinely **optional** — the log reader is the default source;
  ToNSaveManager (when running) still adds the richest live data + lifetime stats and
  takes over while its WebSocket is connected.

## [1.0.12] - 2026-06-13

### Added
- **Custom sidebar icons.** The nav rail now uses a full set of custom icons (one per
  tab) instead of emoji — much clearer. Icons live in `assets/icons/<tab>.png` and are
  swapped in automatically; a missing file just keeps the emoji.
- **About page** — a new tab with the app version, what KitsuNexus is, that it's made
  by **NekoSuneVR**, links (GitHub, repository, releases, issues), a **Check for updates**
  button, and a **Contributors** list auto-detected from the GitHub repository.

### Changed
- **Notifications reworked.** The bell badge now counts **unread only** (not every cached
  item — fixes the count staying at e.g. "16" after you'd reviewed them). The bell opens a
  **tabbed popup** — 👋 Requests · 📨 Invites · 🔔 Alerts · 📣 Groups — each tab showing its
  unread count. **✓ Mark all read** clears the badge, and opening the bell marks them read.
  Group announcements/events now appear in the Groups tab.
- **ToNSaveManager is now labelled optional.** Reading ToN directly from VRChat's log
  (so it works without ToNSaveManager's WebSocket) is on the roadmap (see TODO).
- **Richer GitHub release notes** — releases now include the changelog's Added/Changed/
  Fixed sections and a downloads list, not just the compare link.

## [1.0.11] - 2026-06-13

### Added
- **Online count by platform.** The top-bar count now reads **🌐 Total** (all platforms,
  from VRChat) plus **🖥️ Steam** (PC desktop/PCVR, from Steam's public player-count API
  for VRChat) and **🥽 Quest** (everything non-Steam = total − Steam: Quest standalone,
  Meta Store, mobile). Same method the public VRChat metrics sites use; no extra keys.

## [1.0.10] - 2026-06-13

### Changed
- **VR-friendly save copy.** Tap anywhere on a backup row to copy its code to the
  clipboard — no need to highlight text (which you can't do in VR). Removed the
  read-only code textarea and the advanced raw decode/diff tools from the Save backups
  view; importing already reads your achievements automatically.

### Fixed
- **World now shows after an app restart/update.** The right-rail world + radar are
  primed from the current VRChat log on startup, instead of only updating on the next
  world change (which left it stuck on "Not in a world").
- **Avatar falls back to a VRChat icon** in the right-rail profile when you have no
  profile picture (or it fails to load), instead of the app logo / a broken image.

## [1.0.9] - 2026-06-13

### Changed
- **Import a save → instant catch-up.** Pasting your save code and clicking **Import &
  catch up** now automatically decodes your achievements and ticks them on the board in
  one step — no manual decode/apply, and it jumps you to the achievements view with a
  plain summary ("Imported from <name> — 13/200 achievements, 10 newly added"). The
  technical decode/diff tools are tucked into clearly-labelled **Advanced (developer)**
  sections you can ignore.

## [1.0.8] - 2026-06-13

### Added
- **Update checker** — on launch the app asks the GitHub Releases API for the latest
  version and, if a newer one exists, shows an "Update available" dialog with the
  release notes and two choices: **Install update** (opens the Windows installer
  download) or **Remind me later** (dismisses; it checks again next launch).
- **Reset all ToN data** — a button in the Terrors → Player data card clears every
  board unlock (achievements/items/rounds), all terrors/maps seen, and the round
  history, behind a confirmation. Save-code backups are kept (they have their own
  Clear button). Lifetime stats live in ToNSaveManager and repopulate on connect.

## [1.0.7] - 2026-06-13

### Added
- **Windows installers + release publishing** — the app now ships as an NSIS `.exe`
  setup and an `.msi`, built in CI for Windows/macOS/Linux. Fixed the GitHub Actions
  release job (write permission, publish on any tag, resilient to a failing OS leg).

## [1.0.6] - 2026-06-13

### Changed
- **Real ToN save decoder (replaces the 1.0.5 bitfield heuristic).** The save format
  was fully reverse-engineered from the decompiled world save engine: it's a four-layer
  obfuscation onion — `_convert` (custom Base64 alphabet) → 8-char seed prefix →
  scramble via Unity's `Random` (xorshift128, `Range(0,n)=next()%n`) → bytes + checksum
  → a length-prefixed field schema. The app now **fully decodes** an imported save:
  unscrambles it, verifies the checksum, and reads the **exact** achievement unlocks
  (and the save owner's name) — deterministic, no bit-order guessing. "Decode A → Apply
  to board" now lights up your true unlocks. The earlier 1.0.5 "achievement bitfield"
  guess was a false lead (the digit-runs it read were scramble artifacts) and has been
  removed.

## [1.0.5] - 2026-06-13

### Added
- **Locked / Unlocked filter on the Terrors reference board** — a new **All ·
  ✓ Unlocked · 🔒 Locked** toggle filters every category (achievements, terrors,
  items, locations, rounds) by unlock state. Combines with the existing search
  (names + unlock hints), and the header shows a live "showing N" count while a
  filter or search is active. Active category/filter buttons are now highlighted.
- **AudioLink avatar parameter reference** — the AudioLink tab and `FEATURES.md`
  now document the exact OSC avatar parameters the app sends (Low/Bass/Mid/Treble/
  Volume/Peak floats `0.0–0.92` + `Beat` bool) and how to add them to an avatar.
- **Import a ToN save code** — paste a `[START]…[END]` code (from ToNSaveManager,
  another PC, or a friend) into the Save backups panel to store it alongside the
  auto-captured backups. Codes are validated and `[START]/[END]` + whitespace are
  stripped automatically.
- **Save decode / diff (structural)** — a new lossless decoder turns a save code
  into its exact record→field structure (values kept as strings so big bit-packed
  integers and leading zeros survive), and **diffs two saves** to list exactly which
  fields changed. The format is proprietary with no public schema, so fields are
  intentionally **left unlabeled** — diffing is the supported way to work out what
  each field means. The app does **not** guess/auto-mark board unlocks from a save.
- **Catch up from stats** — a one-click button recomputes the lifetime-stat
  milestone achievements from the latest ToNSaveManager stats snapshot.
- **Decode achievement unlocks → catch up board** — reverse-engineered the save
  format enough to read the **achievement bitfield** (200 unlocks packed into one
  big integer) out of an imported save. The Save backups panel can decode it,
  **preview** the unlocked achievements, then **Apply to board** to light up the matching
  achievements on the reference board. Only achievements that match a board entry
  are marked — nothing is guessed. The bit order is **confirmed LSB** (verified across
  two players via the reserved "placeholder" achievement slots), and the decoder
  auto-warns if a chosen order marks an unreleased achievement as unlocked. (Other
  unlock categories aren't reliably identifiable from one save — the format is
  variable-length, so use Save diff on two same-player saves to map those.)

## [1.0.4] - 2026-06-10

### Added
- **Friends' worlds with privacy** — the Friend Den, right-rail and user popup now
  show the **world name** a friend is in for joinable instances
  (Public / Friends / Friends+ / Group / Group+), the instance type, and their
  status message. **Invite-only, Invite+ and Group-members instances show
  "🔒 In private world"** and never leak the world name.
- **Self-invite & copy world URL** — for a friend in a joinable instance, the user
  popup has **➡️ Invite me here** (self-invite to their instance) and **📋 Copy
  world URL** (a `vrchat.com/home/launch?...` link). Private instances point to
  Request Invite instead. World names are cached to stay light on the API.

## [1.0.3] - 2026-06-09

### Added
- **Live achievement auto-unlock** — when the game fires an achievement (WS
  `TRACKER { event:"achievement" }`), it's marked unlocked on the board instantly
  with a toast.
- **Dated save backups** — the in-game save code (WS `SAVED` event) is captured
  automatically into a timestamped backup history (last 200). Copy any code back
  to your clipboard to paste in-game and restore. Included in export/import.
- **Auto-connect on the Terrors tab** — opening 👻 Terrors connects to
  ToNSaveManager and **keeps retrying every 5s until connected**, with a live
  status line (🟢 connected / round info / 🔴 retrying) and rolling stat,
  encounter and ✓-marker updates — no need to toggle anything on the Stats tab.
- **Built-in ToNSaveManager management** — Install / Start / Stop / Update the
  ToNSaveManager app from the Terrors tab (downloads the latest release from
  GitHub, extracts and runs it in the background — the same job as the official
  `update.bat`, built in). Optional **auto-launch on app start** so the WS source
  is always up. No more separate download/update step.
- **VR / desktop alerts** (via `@nekosuneprojects/vrnotications`) — achievement
  unlocks (and optionally new-terror encounters) pop a notification **with the
  achievement/terror art as the icon**, **auto-routed** by whether you're in VR:
  XSOverlay or OVR Toolkit overlay toast when running, otherwise a Windows desktop
  notification. Channel is selectable (Auto / XSOverlay / OVR Toolkit / Windows /
  Off) with a Test button on the Terrors tab.

## [1.0.2] - 2026-06-09

### Added
- **ToN Reference tab** (👻 Terrors) — a fully **native, in-app** board (no
  embeds / no iframes): browse **Achievements** (with unlock hints + tips + art),
  **Terrors** (with art, ✓-marked once you've encountered them), **Items**,
  **Locations** (✓-marked once visited) and **Round types**, all searchable.
- **Offline ToN reference cache** — the dataset is fetched from terror.moe
  (achievements + terror roster) and tontrack.me (locations / items / rounds),
  stored locally so the board works offline, and auto-refreshed (re-fetching
  picks up anything new the sites add). Includes a manual "Refresh" button.
- **Cached icons + locked/unlocked board** — all achievement & terror art is
  downloaded to a local icon cache. Entries render **grayed-out when locked** and
  in **full colour when unlocked**, with the "how to unlock" hint shown. Terrors &
  maps auto-unlock from live play; **click any entry to toggle** its unlocked
  state (persisted). Each category shows an `X/Y unlocked` count.
- **Offline round history** — every finished round (type, terror, map,
  survived/died, duration) is saved locally and shown as a history list.
- **Terror/map encounters** — tracks how many distinct terrors you've "bumped
  into" and maps you've seen across sessions, persisted between launches.
- **Export / Import player data** — back up or move your ToN stats, encounters
  and round history as a JSON file.
- **ToNSaveManager integration** (Terrors of Nowhere) — connects to
  ToNSaveManager's local WebSocket API (Stats tab, default port `11398`) and
  surfaces the live round (round type, terror, map, alive/opted-in status,
  players in instance) plus lifetime + per-session stats (rounds / deaths /
  survivals / win rate / damage taken / stuns / records). Auto-reconnects when
  ToNSaveManager is closed or restarted, can show its own chatbox line, and adds
  a `{ton*}` token family: `{ton}` `{tonround}` `{tonterror}` `{tonmap}`
  `{tonalive}` `{tonplayers}` `{tonrounds}` `{tondeaths}` `{tonsurvivals}`
  `{tonwinrate}` `{tondamage}` `{tonstuns}`. Requires ToNSaveManager's
  "WebSocket API" enabled.
- **ToN achievements** — a milestone achievement system derived from your ToN
  stats (15 badges across rounds played, survivals, deaths, damage taken, stuns
  and win rate). The ToN card shows a stats grid and the full achievement list
  split into **✓ Unlocked** and **🔒 Locked** (with live progress %), and pops a
  toast on the status line the moment a new one unlocks.
- **Create group instances** — pick a world (your worlds + favourites) with
  access (members / group+ / public) and region, created from the group modal.
- **VRCVideoCacher** — install/update + start/stop the local video-cache proxy
  from the VRChat Tools tab.
- **Bio prefabs** — save/load/edit/delete reusable bios in the Profile Editor.
- **Discord RP buttons without the Game SDK** — buttons now survive over the local
  IPC RPC via a richness ladder (art+buttons → buttons only → art only → text),
  instead of being permanently dropped on a single error.

### Changed
- **No native node-gyp modules** — replaced `node-window-manager` (which broke
  Windows/macOS CI builds via `extract-file-icon`) with the OS's own CLI for
  window activity (PowerShell / `osascript` / `xdotool`). Builds now need no
  C++/Python toolchain.

### Performance
- 429 rate-limit backoff is now honoured by every poller; pollers are staggered
  on launch; right-rail sections cap at 150 rows; all dynamic images are
  `loading="lazy" decoding="async"` to cut memory and prevent crashes.

## [1.0.1] - 2026-06-09

### Performance
- **Far fewer background processes** — fixed the "too many programs running" lag
  where the app spawned a constant churn of `powershell.exe` and `conhost.exe`
  ("Console Window") processes:
  - **System & Network stats** now route every CPU/GPU/RAM/temperature/network/
    ping query through a single, reused PowerShell session (via
    `systeminformation`'s persistent shell) instead of spawning a brand-new
    `powershell.exe` (+ `conhost.exe`) for *every* reading. The shell is
    ref-counted: started when the first poller turns on, released when the last
    one turns off.
  - **Window Activity** polling slowed from every 3s to every 10s (5s floor),
    cutting its PowerShell spawns by ~70%.
  - **System Stats** poll interval relaxed 3s → 5s; **Network Stats** 3s → 5s.

## [1.0.0] - 2026-06-09

🎉 First release of **KitsuNexus** — a standalone VRChat OSC companion by NekoSuneVR,
built on the proven OSCAudiolink architecture.

### Added
- **Chatbox** — manual typing to VRChat (`/chatbox/input`) plus an auto-rotating
  composer that cycles live data lines into the chatbox.
- **Status presets** — templated lines with tokens (`{time}`, `{song}`, `{cpu}`,
  `{gpu}`, `{ram}`, `{hr}`, `{down}`, `{up}`, `{ping}`, `{tiktok}`, `{twitch}`,
  `{kick}`, `{window}`).
- **AudioLink** — real-time spectrum (Low/Bass/Mid/Treble) sent over OSC, carried
  from OSCAudiolink.
- **Now Playing** — Windows media session detection with **KAT** (KillFrenzy
  AvatarText) support and optional chatbox posting.
- **Live follower counters**:
  - **TikTok LIVE** (via `tiktok-live-connector`) — total followers, session
    new-follows, viewers, likes.
  - **Twitch** (Helix API) — follower total.
  - **Kick.com** (channel JSON endpoint) — follower total + live/viewer state.
- **TikTok TTS** — community `gesserit.co` voice synthesis (with proper JSON escaping
  of the spoken text).
- **IntelliChat** — OpenAI-powered rewrite / spellcheck / shorten / translate.
- **Component stats** — CPU/GPU/RAM load & temps via `systeminformation`.
- **Network stats** — up/down throughput and ping.
- **Window activity** — active window/app title.
- **Heart rate** — live BPM from **Pulsoid** over WebSocket.
- **Discord Rich Presence** — show KitsuNexus on your Discord profile.
- **VR gear battery** — module scaffold (needs a native OpenVR helper; see README).
- **OBS overlay** — browser-source now-playing overlay with multiple styles.
- **Theme engine** — Midnight, Dark, Neon, Rainbow, Pink, Green, Light.
- **Cross-platform CI** — GitHub Actions builds Windows, Linux and macOS installers.

### Discord (full integration)
- **Rich Presence** + **voice detection**: current voice channel name, user count, who's
  speaking, and your mute/deafen state — shown in the app, available as a chatbox line
  (`💜 channel (n) 🔇`) and sent to VRChat as avatar OSC params. Falls back to Rich
  Presence if Discord rejects the private voice scope.
- **VRChat world in Rich Presence** — the current world name is read live from VRChat's
  output log and shown on your Discord profile, with up to two clickable buttons:
  **🌐 Join World** (deep-links into your instance) and **👤 VRChat Profile**.
- **VRChat status privacy gate** — a status selector (🟢 Join Me / 🔵 Active /
  🟠 Ask Me / 🔴 Do Not Disturb). The world name and Join button are only revealed on
  **Join Me / Active**; **Ask Me / Do Not Disturb** hide your location. Changes apply to
  the live presence instantly. Your profile URL is auto-detected from the log (with an
  optional manual override).

### VRChat world tracking
- New **world tracker** that tails VRChat's rolling `output_log` to detect the current
  **world name, world ID, instance ID** and your own **user ID** — used to build the
  Discord join/world/profile links. Reacts to joining, leaving and new game sessions.

### Startup / auto-start
- New **Startup** card in Settings: **Launch on system login**, **Start minimized to
  tray**, and per-feature **auto-start on launch** for Discord, Heart rate, Component
  stats, Network stats, Window activity, Twitch and Kick — saved tokens/IDs are reused,
  so there's no need to press Connect every launch.

### Performance (round 2)
- **Single-instance lock** — fixes the process count ballooning (e.g. 23 Electron
  processes) when launched more than once.
- **Hardware acceleration disabled** — drops "GPU Very high" to near zero on this
  lightweight UI.
- **Now Playing is now lazy** — the PowerShell media query only runs when something
  uses it (KAT, chatbox now-playing, a {song} preset, or the Now Playing tab open).
- **Component stats**: expensive GPU/temperature WMI queries refresh every 6th tick
  (not every tick) and never overlap; network ping every 5th tick.
- Global `uncaughtException` / `unhandledRejection` guards so a flaky network/poller
  can't hard-crash the app.

### Performance (round 1)
- Canvas redraws (spectrum + OSC graph) are **skipped when their tab isn't visible**
  and the OSC graph is throttled to ~6fps — big win for an always-running app.
- OSC log is now a **capped 200-line buffer** flushed twice a second (prevents lag
  when VRChat floods incoming OSC).
- Now Playing PowerShell query polls every 8s instead of 5s.
- Removed the runtime **Tailwind CDN** (unused) — faster, offline, no MutationObserver.

### Settings persistence
- Status presets **auto-save** as you type; Stats/Network/Window toggles and the
  rotation interval persist and auto-restore on launch.

### Chatbox
- **Multi-line layout** — every source can be its **own permanent line** or join the
  single **rotating line** (cycles one item at a time), matching the stacked in-game
  chatbox look. Rotating line can sit at the top or bottom, with a live preview.
- **Heart rate session stats** — the HR line shows `bpm | avg | max | min`.

### Rebrand → KitsuNexus
- App renamed from **NekoSuneOSC / NekoChatbox** to **KitsuNexus** (title, tray,
  brand, installer appId `com.nekosunevr.KitsuNexus`, RPC strings).
- **Sidebar regrouped** into **VRChat / Tools / General** sections.
- **Modules reorganised** — VRChat-specific modules now live under
  `modules/vrchat/` (`osc`, `chatbox`, `status`, `audio`, `world`, `vr`); new OSC
  control modules will nest under `modules/vrchat/osc/`.

### Tools
- **Stopwatch** — live display, send-to-chatbox, optional live-updating chatbox line.
- **Calculator** — mathjs-powered expression evaluator with send-to-chatbox.
- **Auto-AFK** — idle detection via the OS idle timer; posts a customisable AFK /
  back message (tokens `{mins}`, `{time}`) to the chatbox.

### Heart rate (Pulsoid + HypeRate)
- **HypeRate.io** added as an alternative provider alongside Pulsoid (pick per the
  Provider selector; HypeRate needs an API key + device/session ID).
- **Session history** — every heart-rate session is saved (duration, avg, min, max,
  samples, provider) and listed in the Heart rate card; clearable.
- **Discord presence enrichment** — the Rich Presence now contextually shows your
  VRChat world, **❤️ live BPM**, and **🎵 now playing**, with per-item toggles. The
  presence "switches" by context: world when in VRChat, otherwise the current song.

### VRChat cluster
- **Auto status detection** — optional VRChat account login (in the new **VRChat**
  tab) reads your live status (🟢 Join Me / 🔵 Active / 🟠 Ask Me / 🔴 DND) via the
  VRChat API and auto-applies it to the Discord world-visibility gate. Handles email
  & authenticator 2FA; **password is never stored**, only the session cookie.
- **Radar** — live list + count of players currently in your instance, parsed from
  the VRChat log (`OnPlayerJoined` / `OnPlayerLeft`). Player count is exposed as the
  `{players}` chatbox token.
- **Weather** — current conditions via Open-Meteo (free, no key); pick a city + units.
  Exposed as the `{weather}` chatbox token and shown in the VRChat tab.
- **VRChat Tools** (inspired by VRCNext, all external/file-based — no game injection):
  **YouTube fix** (downloads the latest `yt-dlp.exe` into VRChat's Tools folder so world
  video players work), **cache size / clear**, and quick **open-folder** shortcuts
  (data, cache, tools, photos).

### UI — VRCNext-style layout
- **Three-column layout**: a slim **icon rail** (hover tooltips, app logo, live **clock**,
  round **Launch VRChat** button) · the content area · a **right friends panel**.
- **Right friends panel** — your profile + current instance + **friends grouped by
  Same Instance / Online** (avatars, status dots, locations) with a search box, from the
  VRChat API (auto-refresh).
- **Notifications flyout** — a 🔔 bell with an unread badge; lists VRChat notifications and
  **Accept**s friend requests inline.
- **Click a friend → tabbed profile modal** (VRCNext-style): **Info** (banner, avatar, trust
  rank, platform/18+/VRC+, status, bio + links, **badge images**, joined/last-login, age-verified,
  avatar-cloning), **Groups**, **Content** (public worlds), **Mutuals** & **Favs.** (explained
  where VRChat keeps them private). Actions: **Add Friend ↔ Unfriend** (auto-detects existing
  friendship), **Invite** (to your instance), **Request Invite**. Boop is in-game-only — explained,
  not faked.
- **Scrollbars hidden** everywhere (still scrollable) for a tidier look.

### UI overhaul — tidier, green, seasonal
- **Split the crammed mega-pages into focused pages** — the VRChat tab became
  **VRChat / Radar / Weather / OSC Control / VRChat Tools**; **Heart Rate** got its own
  page (out of Stats); **Discord** and **Overlay** split from Integrations.
- **Sidebar regrouped** into **VRChat · Social · General** with one page per feature.
- **Green is now the default theme.** The **theme switcher was removed** — the theme is
  fixed/auto-selected.
- **Auto seasonal themes** (not user-switchable): 🎃 Halloween (late Oct), 🎄 Christmas
  (Dec), 🏳️‍🌈 Pride (June), 🐰 Easter (computed), green otherwise — with a season badge
  in the top bar.

### History, auto-greeter & more tools
- **📜 History** — a real **SQLite** game-log (via `sql.js`, no native build) recording
  **player join/leave**, **friend added/removed** (diffed), and **world visits**; filterable
  timeline with clear. (New dep: `sql.js` — run `npm install`.)
- **👋 Auto-Greeter** — auto-accept friend requests (everyone or an allow-list); logs to History.
- **🎚 Param Lab** — send any OSC avatar parameter (bool/int/float).
- **📸 Photo Relay** — auto-upload new VRChat screenshots to a Discord webhook.
- **⭐ Favorites** — add/remove favorites (worlds in the world modal, friends in the profile modal).

### VRChat browser (search + detail)
- **Search** page — search **users / worlds / groups** (results are clickable cards).
- **Open by ID / URL** — paste a `usr_`/`wrld_`/`grp_` id or a vrchat.com link to open it.
- **World** and **Group** detail modals (image, author/members, description, stats, open-on-VRChat).
- Group/world cards everywhere are now clickable into those modals.
- Profile modal: real **Boop** (`POST /users/{id}/boop`), **Mutuals** (friends via `/mutuals`,
  groups via intersection), **Favs** (own worlds), **Add Friend ↔ Unfriend**, **Invite**.
- **My Groups** + **My Content** (worlds/avatars) sidebar pages.
- Friends fetch is now **paginated** (full list, not just the first 100).

### VRChat companion (VRCNext-style, our names — all API/local, no game injection)
- **🫂 Friend Den** — your online friends and where they are (status + location), via the
  VRChat API, with optional 60s auto-refresh.
- **🔭 Event Scout** — track upcoming events across **multiple** VRChat groups; tick the
  groups to watch and their events are merged and sorted.
- **🐾 Pawprints** — local per-world **time-spent** tracking from the VRChat log.
- New sidebar entries for each; built on the existing VRChat login.

### Discord voice bot + OSC control
- **Discord Voice Bot** — the no-allowlist alternative to the private `rpc.voice.read`
  scope. You run your own bot (paste its token), invite it to **your own private
  server** (an invite link with the right perms is generated), and it stays
  **invisible/offline**. It reads your voice state (channel, user count, mute/deafen)
  and reports **call started / ended**.
- **DiscordOSC** — VRChat avatar params can **server-mute / server-deafen** you via
  the bot (`/avatar/parameters/VRCOSC/Discord/Mute` · `/Deafen`).
- **SpotiOSC** — VRChat avatar params control Spotify via global media keys
  (`/avatar/parameters/VRCOSC/Spotify/PlayPause` · `/Next` · `/Previous` · `/Stop`).
- **Soundpad** — control Leppsoft Soundpad (play by #, stop, next/prev, pause,
  random, load sound list) via its Remote Control pipe. (Tools tab.)
- New dependency: `discord.js` (run `npm install`).

### Docs & policies
- New **[FEATURES.md](FEATURES.md)** — full feature list + safety summary (no data
  collected/shared, no code injection into VRChat or any app, account/ban risk is the
  user's own and tied to following each platform's ToS).
- **README** rebranded with banner; **TOS / PRIVACY / DISCLAIMER** updated for the new
  features and a clear "no code injection / use at your own risk / not responsible for
  bans" stance. Feature requests → the GitHub Issues page.

### Build / packaging
- **Cross-platform installers fixed** — Windows (NSIS + MSI), Linux (AppImage + deb)
  and macOS (dmg + zip) now build cleanly in CI:
  - added the required author **email** / Linux **maintainer** (deb/AppImage need it),
  - switched the macOS & Linux icon to a 1024×1024 **PNG** (`.ico` isn't valid there),
  - disabled macOS code-signing/notarization in CI (no certs on the runner),
  - removed the bogus `dgram` dependency (it's a Node.js built-in).

### Notes
- TikTok uses **tiktok-live-connector v2** with [Euler Stream](https://www.eulerstream.com)
  signing. Add a free API key in the TikTok card if you hit `SignatureError`.
- Network/native work runs in the Electron **main process** and is exposed to the
  renderer through preload IPC.
- VR gear battery is a documented extension point and currently reports
  "unavailable" until a native OpenVR helper is wired in.
