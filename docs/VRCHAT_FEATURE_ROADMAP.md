# KitsuNexus VRChat feature roadmap

This is an original KitsuNexus implementation plan. All integrations should use local VRChat logs, the official VRChat API where permitted, supported OSC, and user-authorised services. Never inject into VRChat, scrape private data, or bypass avatar permissions.

## Implemented in PR #21 (first slice)
- [x] Independent desktop HUD and dedicated VR HUD render surface
- [x] Windows media-key shortcuts: play/pause, previous, next
- [x] Quick OSC chatbox send with local toggle
- [x] Manual translation preview using the configured local project translation integration
- [x] Current world name sourced from local VRChat logs
- [x] Current instance player names and join/leave notices sourced from local logs
- [x] Now-playing and heart-rate HUD feeds
- [x] Persist desktop HUD window position and size
- [x] HUD click-through controls
- [x] Persist click-through and other window options between sessions
- [x] Export current local world and player snapshot in JSON/CSV with formula-safe CSV cells
- [ ] Physically validate OpenVR display/capture in SteamVR
- [ ] Run packaged Electron smoke tests on Windows

## PR #23 progress (not yet release-verified)
- [x] Desktop HUD visibility fallback, off-screen bounds recovery and actual visibility reporting
- [x] Emergency Ctrl+Shift+F10 click-through recovery while the desktop HUD is running
- [x] Bounded, scrollable join/leave notification history with clear action
- [x] HUD-local persisted translation target, Enter-to-send, notification limits and fade duration
- [x] HUD-local visibility toggles for player list, statistics, music and heart-rate tiles (not independent native windows)
- [~] SteamVR device status: optional helper transport, response validation, disconnect reporting and stale-response suppression implemented; native OpenVR helper and real device readings still missing
- [ ] Windows packaged HUD smoke tests and physical SteamVR validation

- [x] Separate persisted join/leave notification filters in PR #23
- [x] HUD layout presets and local OSC message presets added in PR #23
- [~] Local history module, unit tests, opt-in live world/player/portal event recording and desktop HUD history browser/clear implemented; full retention controls, exports and runtime tests pending

## HUD / Quick Actions
- [~] Optional renderer-side live HUD, player monitoring, music and heart feed controls; upstream collection must also be disabled when off before this is complete
- [ ] Direct language selector and multiple translation targets
- [ ] Push-to-talk / voice translation with microphone consent
- [~] In-window draggable layout plus independently resizable Electron pop-out windows for players/notices/stats/lyrics; saved game-relative pop-out geometry restored across restarts (automated coverage); packaged testing pending
- [~] Local player search and pins, notice pause, optional FPS/status tiles and lyrics text surface implemented; real FPS/lyrics providers, syncing and independent windows pending
- [~] Notification corner selector (inline/four corners), visibility, limits, fade, scroll, pause and text-size control; independent native notification window with idle hiding implemented; live/packaged acceptance still pending
- [ ] OS-level hotkeys and user-configurable safety gate
- [ ] Script-created windows in an isolated, permission-controlled sandbox
- [ ] In-headset input only after proper native OpenVR interaction testing
- [~] Desktop window recovery after monitor disconnect/metrics changes, reachable title bar, always-on-top and click-through recovery hotkey; explicit monitor selector and VRChat window anchoring pending

## SteamVR device status
- [ ] Real HMD/controller/tracker battery readings, charging and low-battery alerts
- [ ] Base station presence, headset proximity, tracked/connected state
- [ ] Native OpenVR helper and device-model fallbacks for missing battery properties
- [ ] Reconnect/disconnect handling and throttled polls
- [ ] Testing with real hardware and SteamVR without claiming unsupported devices work

## VRChat identity, groups and moderation
- [ ] Review existing username/password login, TOTP/email verification and sign-out flows
- [ ] Recovery-code support, encrypted multi-account profiles, safe account switching
- [ ] Profile editor for bio, links, pronouns and status, with API permission checks
- [ ] Copy public profile fields to preview only, requiring explicit user confirmation to apply
- [ ] Group details, membership, posts and joins; write actions only when the API permits
- [ ] Group ban/unban, roles, audit logs and instance moderation with explicit permissions and confirmation
- [ ] No mass member action without user confirmation, rate-limiting, and permission checks

## Worlds, players and history
- [ ] Save recent instances, visited worlds, player encounters and visit timestamps locally
- [ ] Player notes, alias-safe IDs, name matching and data retention controls
- [ ] Search worlds and available instances via approved VRChat APIs
- [ ] Create supported instance types: Public, Friends+, Invite, Group (only authorised cases)
- [ ] Portal detection using local logs, with reliable validation before offering join actions
- [ ] Local history browser with CSV export and configurable privacy/retention policies
- [ ] Public avatar information lookup only when visibility/permissions allow it
- [ ] Never bypass clone restrictions, hidden-avatar permissions, or private player data
- [ ] Never label people as KitsuNexus users unless they have explicitly opted in

## Avatar library and OSC
- [ ] Import local VRCX favourites where the user selects the export/file
- [ ] Import and sync own favourite avatars using permitted API operations
- [ ] Avatar collection CRUD, duplicate detection, broken ID detection, CSV and JSON export
- [ ] Provider plug-in interface with explicit opt-in, licence checks and per-provider throttling
- [ ] Search metadata across user-authorised public avatar sources
- [ ] OSC parameter browser, per-avatar refresh, read/write validation, live monitor
- [ ] OSC chatbox message presets, status presets, typing indicator and optional voice activity
- [ ] Avoid avatar ripping and do not clone or save restricted/private assets

## Data portability
- [ ] Full local settings/history/collections backup and restore with schema version
- [~] JSON and CSV exports (current world snapshot implemented); safe ID list imports and avatar collection exports pending
- [ ] User-selected VRCX input migration and old-version migration
- [ ] Signed share packs with manifest validation; reject executable scripts by default
- [ ] Restore dry-run and rollback in case of invalid or incompatible data
- [ ] Never export cookies, passwords, OAuth tokens or private encryption keys by default

## Release acceptance criteria
- [ ] `npm test` passes on the branch
- [ ] Packaged Windows executable opens, shows and hides overlays, remembers geometry
- [ ] All HUD controls operate without running the SteamVR runtime
- [ ] SteamVR HUD renders when a headset is connected and clearly errors when unavailable
- [ ] No cross-account leakage; no external telemetry or unexpected network destinations
- [ ] No new external packages without a supply-chain review

## Test-build handoff (1 November 2026)
- [x] Desktop HUD, pop-out windows and opt-in local history changes pushed to draft PR #23; keep unmerged during user testing.
- [x] Updated HUD preference storage-key expression after GitHub Actions Gitleaks flagged the local-storage identifier as a potential `generic-api-key` secret. The literal is a non-secret UI preference key.
- [ ] Confirm the new PR security audit passes after the storage-key change.
- [ ] Confirm `npm test` and Windows Electron packaging succeed; existing manual Build KitsuNexus workflow must be run with `runner_type=github-hosted`, `build_target=windows`, `upload_artifacts=true`, `publish_release=false` for a private test artifact.
- [ ] Verify desktop HUD windows, saved geometry, history and opt-out behavior on Windows; no SteamVR hardware required for desktop testing.
- [ ] Native OpenVR helper, device readings, FPS/lyrics providers and physical SteamVR validation remain deferred.

## Local implementation progress (2 November 2026)
- [x] HUD history retention controls (1–365 days), local search, and JSON/CSV save-dialog exports.
- [x] Retention regression test for persistent deletion, invalid policies, and expiry while reading.
- [ ] Interactive Windows validation and remaining roadmap integrations.

### Local history test steps
1. Start the app with `npm start`, then Stats → Start desktop HUD.
2. Use History to browse saved entries; search by player, world, instance or event type.
3. Export CSV and JSON, choose a destination, and inspect the saved file. Canceling must not write a file.
4. Change Keep history (days) within 1–365. Confirming permanently deletes older entries; canceling retains the current policy.
5. Restart the app and confirm the retention value persists.
6. Turning recording off must stop new entries while leaving saved records available for browsing/export.

Automated verification on 2 November: 72 tests pass. App and HUD accessibility trees load with the new controls. Native screenshot capture timed out; fallback desktop screenshots did not show the HUD, so visual HUD verification remains unresolved. Windows directory packaging was started locally; do not treat an unfinished output folder as a release build.

### Desktop HUD runtime check (2 November 2026)
- Visually confirmed the HUD over the running desktop VRChat client after replacing layered transparency with a solid desktop window background.
- Current local world and player feed showed Avatar Testing Chamber and one player.
- Keyboard navigation scrolled the panel to history/settings; CSV export opened the expected native save dialog. Canceled that dialog with Escape.
- 72 automated tests passed after the window/scroll changes. Native window capture still times out; visual checks used the documented desktop_inspect fallback and inspected its exact PNG output.
- SteamVR, chatbox sending, translation providers, live joins/leaves, retention deletion and pop-out interaction were not exercised in this desktop check.
- Start directly with `npm start -- --desktop-hud`.

### Game-attached desktop redesign (2 November 2026)
- [x] Restyled HUD with teal/mint cards, consistent inputs and expandable advanced controls.
- [x] Read-only Win32 client-area tracking, VRChat executable matching, foreground/minimized visibility gating and game-relative saved desktop position.
- [x] Visually verified the redesigned HUD over live VRChat and its disappearance after switching to KitsuNexus. 72 automated tests pass.
- [ ] Exclusive fullscreen, mixed-DPI monitor movement and restart persistence need further runtime coverage. Use windowed/borderless VRChat for this desktop overlay.

### Desktop activity alerts (2 November 2026)
- [x] Timestamped join/leave, explicit portal, avatar load/switch and world-transition cards with category filters, pause, clear, fade and bounded in-memory history.
- [x] Suppress startup/rotated-log replay; preserve joins/leaves within a polling interval; safely render event text.
- [x] 75 automated tests pass, including explicit log-format parser fixtures and bounded snapshots. Visually confirmed the empty activity box in the running HUD over VRChat.
- [ ] Validate new live portal drops, another player's join/leave, avatar changes and instance travel during user testing. Portal/avatar events require recognized local log messages; no remote or private-avatar data is fetched.

### HUD interaction and transient alerts (2 November 2026)
- [x] Ctrl+Shift+F9 toggles focused HUD interaction; Escape/Back to game returns native focus to VRChat. Normal play uses click-through, non-focusable HUD windows.
- [x] Corner docking and game-relative movable detached-panel offsets.
- [x] Alerts-only preference hides HUD controls in play, displays stacked activity cards with individual ten-second expiry, and hides the idle window. Hotkey restores the editing interface.
- [x] 77 automated tests pass, including interaction input routing and alerts-only visibility regression checks.
- [x] Visually verified edit mode over VRChat, top-right docking, and idle hiding with game focus restored.
- [ ] Live simultaneous alert expiry/stacking, detached-panel dragging and Discord overlay ordering need user testing; repositioning avoids overlap rather than controlling Discord's injected overlay.

### Current portal-log format fix (2 November 2026)
- [x] Recognize `[PortalManager] Pending portal request fulfilled.` observed in the user's current output log at 15:14:36.
- [x] Share portal parsing between HUD activity and world/history state; preserve explicit named drop messages.
- [x] Actual log scan matches the portal event. 78 tests pass with `node --test --test-concurrency=1`; default parallel run had an unrelated OSC subprocess timeout, which passed on isolated rerun.
- [ ] Confirm the next newly placed portal produces an alert in the running HUD. Request completion is reported honestly without asserting creator, destination or confirmed placement. Past events remain suppressed on startup.

### Partner portal runtime limitation (2 November 2026)
Two partner portal tests produced `[PortalManager] Received portal destroy event.` at 15:25:31 and 15:26:04, with nearby generic inventory lookups but no explicit creation/placement message. The local request-completed parser does not establish reliable other-player placement detection. Keep this unverified; generic inventory fetches must not be treated as portal creation or attributed to a creator.
HUD interaction shortcut: Ctrl+Shift+F9, with Escape to return to the game.

### HUD shortcut recovery (2 November 2026)
- Added Ctrl+Alt+F9 fallback, visible registered-shortcut status, registration-failure logging, and Stats → Open HUD controls.
- Explicit open requests locate the VRChat window and tolerate a one-second focus transition; small alert windows restore a usable editor height.
- Activity alerts remain active independently of HUD live/player snapshot toggles.
- Observed portal destruction now reports removal/expiry. Other-player placement is still unavailable from observed logs; no inventory-based inference is made.
- Focus transition and portal-removal regression tests pass. Live desktop automation became unavailable (window listing times out even after reconnect), so these changes need user verification.

### Separate desktop overlays (2 November 2026)
- [x] Added music and heart native windows to players/notices/stats/lyrics; draggable headers, native resizing, close buttons, distinct default offsets and saved game-relative position/size.
- [x] Separate overlays picker near the editor toolbar and reset-overlay-positions action.
- [x] Player overlay search/pins, synchronized preferences/pins/pause across windows, independent native notice idle hiding, and reduced duplicate content in the main HUD.
- [x] Disabled HUD-specific music queries when off/closed, with stale-result suppression. Shared world/player/heart collectors remain needed by other app features; complete upstream opt-out requires consumer ownership tracking.
- [x] 82 automated tests pass, including simulated close/reopen restoration of music/heart geometry, persisted feed-disable state and independent notification visibility.
- [ ] Packaged Windows and physical drag/resize/restart tests remain required. Real FPS/lyrics providers, full shared-collector shutdown, and explicit monitor selection remain pending; do not mark these roadmap items complete.

Direct separate-overlay startup: `npm start -- --desktop-hud --hud-widgets=music,heart,alerts` (optional list: music,heart,players,alerts,tiles,lyrics).

User reported multiple/ghost processes during local testing. Stopped project Electron processes and launcher, confirmed no matching app/launcher remained, and did not relaunch. Added early duplicate-instance exit and before-quit overlay cleanup. Latest automated run: 83 tests pass before this lifecycle change; lifecycle change syntax-checked only. Final visual/pop-out testing remains pending.

### Overlay event/music regression checks (2 November 2026)
- Fixed a blank duplicate main notification box when alerts are detached; pop-outs disable background throttling to keep hidden-window updates active.
- Scoped panel selectors to `.widget` so a body widget attribute cannot capture panel operations/media controls.
- Identical preference submissions no longer invalidate pending music detection.
- Actual isolated Electron renderer test passes for visible music/heart text, three join/leave/avatar cards, expiry and fresh-alert reappearance. PNGs inspected locally. These are explicit synthetic fixtures, not a claim of new live VRChat events.
- Log-tail integration verifies historical suppression and subsequent live-appended join/avatar/leave delivery. Full Node suite: 84 passed.
- Single live-instance diagnostics before final restart confirmed nonempty music data reached the music renderer and its music element had visible layout. Current log event sequence matched collector/renderer sequence. New live user events still require confirmation.
