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
- [ ] Physically validate OpenVR display/capture in SteamVR
- [ ] Run packaged Electron smoke tests on Windows

## HUD / Quick Actions
- [ ] Direct language selector and multiple translation targets
- [ ] Push-to-talk / voice translation with microphone consent
- [ ] Draggable/resizable independent widgets and configurable presets
- [ ] Pinned player-list, lyrics, compact status/FPS and notification windows
- [ ] Overlay corner positioning, notification limits, fade durations, scroll settings
- [ ] OS-level hotkeys and user-configurable safety gate
- [ ] Script-created windows in an isolated, permission-controlled sandbox
- [ ] In-headset input only after proper native OpenVR interaction testing
- [ ] Multi-monitor settings, always-on-top levels, click-through recovery hotkey

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
- [ ] JSON and CSV exports, safe ID list imports, avatar collection exports
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
