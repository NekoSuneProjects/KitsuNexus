# OSC Apps integrations

The OSC Apps sidebar is the shared home for avatar-specific compatibility tools.

## Folder map

- `qr/` — live screen QR detection.
- `recognition/` — desktop-audio capture and normalized recognition providers.
- `clock/` — OSCClock, VRCOSC Clock and DateTime senders.
- `leash/` — native OSC Realistic Leash compatibility.
- `laserdome/` — Rusk Laserdome log-to-OSC compatibility.
Attributed ports keep `UPSTREAM.LICENSE` beside their implementation.

## Rusk Laserdome OSC

The native module is ported from
[`CartoonishVillain/RuskLaserdomeOSC`](https://github.com/CartoonishVillain/RuskLaserdomeOSC),
which is MIT licensed. Its license is preserved in
`laserdome/UPSTREAM.LICENSE`. VRChat debug logging must be enabled for the relevant
`AvatarInteraction` and pickup/drop messages to appear.

## OSC Realistic Leash

Native compatibility for YimuQr's paid BOOTH avatar system. NekoSuneAPPSVRC does not include
or redistribute the product. It responds to `MOF`, `MOB`, `MOL`, `MOR`, `MOFL`, `MOFR`,
`MOBL`, `MOBR`, `STOP`, `Jump`, `JumpS`, `JumpA`, and optionally `JumpQ`. `JumpQ` is
ignored by default because its intended action is undocumented and the avatar also exposes
related internal `JumpQ_*` contact/pose fields.

## OSC Digital Clock

Native MIT-compatible sender for the five float parameters used by
[`Bekosantux/OSCClockSenderAPP`](https://github.com/Bekosantux/OSCClockSenderAPP):
`OSCClock/MonthF`, `DayF`, `HourF`, `MinuteF`, and `DOWF`. It preserves the original
`ceil((value / 127) * 100000) / 100000` encoding and local 24-hour time. The upstream
code spells its weekday path `DoWF`, so that spelling can also be sent for compatibility.
It can additionally send VRCOSC's normalized `VRCOSC/Clock/Hours` and `Minutes` floats
(12-hour or 24-hour mode), plus raw `DateTimeHour`, `DateTimeMinute`, `DateTimeDay`, and
`DateTimeMonth` integers for avatar packages using that parameter set.
The renderer has background throttling disabled, allowing the timer to continue while the
window is hidden or minimized. The upstream MIT license is preserved in
`clock/UPSTREAM.LICENSE`.

## SpotiOSC and DiscordOSC compatibility

Media controls accept both the original `VRCOSC/Spotify/*` paths and VRCOSC's
`VRCOSC/Media/Play`, `Skip`/`Next`, and `Previous` paths. Discord accepts both
`VRCOSC/Discord/Mic` and `Mute`, plus `Deafen`, and publishes
`VRCOSC/Metadata/Modules/YUCP.VIRA.yeusepesmodules.discordosc` while enabled.

These are original NekoSuneAPPSVRC implementations. No source files from the GPL-3.0
Yeusepe module pack are bundled. SpotiOSC uses Windows media sessions/media keys and
publishes playback state; Jam links are opened in Spotify's own UI. DiscordOSC uses the
existing user-configured Discord Voice Bot and publishes its voice state.

## OSCQR

The native renderer module uses Apache-2.0 [`jsQR`](https://github.com/cozmo/jsQR) to
decode frames from a screen/window the user explicitly shares. It supports continuous
scanning, Spotify-link detection, optional AppData history and chatbox output, plus
`OSCQR/StartRecording`, `ReadQRCode`, `QRCodeFound`, `SpotifyCodeFound`, and `Error`.
Screen permission must first be granted from the app because browsers do not allow an
avatar OSC message to silently begin screen capture.
On Windows, choose the exact display or window from the shared capture-source selector
at the top of OSC Apps before starting.

## ShazamOSC-style recognition

This original implementation records up to ten seconds from system audio the user
explicitly shares. Automatic mode uses the official `@audd/sdk` first when an AudD token
is configured, then ACRCloud when its host/key/secret are configured. `node-shazam` is a
detectable external fallback but is not installed or bundled because it is GPL-2.0.
It supports one-shot recognition, configurable live recognition, bass level, saved
matches, links and optional chatbox output. Its OSC surface includes
`ShazamOSC/Recognize`, `Recognized`, `Listening`, `LiveListening`, `Error`, `OSCTrackID`,
and `BassLevel`. See `recognition/README.md` for the provider contract. No fingerprint
code or credentials from the local GPL module pack are copied.
