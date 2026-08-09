# Privacy Policy

**Effective date:** 2026-06-09
**Software:** NekoSuneAPPSVRC ("the App")
**Owner:** NekoSuneVR

Your privacy matters. This policy explains what the App does and does not do with
your data. **Short version: NekoSuneAPPSVRC runs entirely on your own computer. We do
not operate any servers and we do not collect, transmit, share, or sell your data.**

## 1. We collect nothing
NekoSuneAPPSVRC has no backend, no analytics, no telemetry, and no accounts. We, the
developers, never receive any information from your use of the App.

## 2. Local-only settings
Your settings — including any tokens, client IDs, API keys, the VRChat **session
cookie**, the Discord **bot token**, usernames, heart-rate session history, presets,
and toggles — are stored **locally on your device** using the operating system's
per-user application data directory. They never leave your machine except to be sent
directly to the third-party service they belong to (see below).

## 3. Your VRChat password is never stored
The optional VRChat auto-status login authenticates once and keeps only the
**session cookie** VRChat returns. Your password is **not** saved anywhere.

## 4. Direct connections to third parties
When you enable a feature, the App talks **directly** from your computer to that
service using the credentials you provided:

- **VRChat** — OSC messages over local UDP (127.0.0.1); and, if you log in, the
  official VRChat API to read your own status.
- **VRChat logs** — the App **reads the log files VRChat writes on your PC** to detect
  your current world and the players in your instance (Radar). It does not modify them.
- **Discord** — Rich Presence via the local Discord client (RPC), and an optional
  **bot** (your token) that reads your voice state and can server-mute/deafen you.
- **Twitch** — Helix API for follower counts (your OAuth token).
- **TikTok** — public profile / live data (tiktok-live-connector; signing via Euler Stream).
- **Kick** — public channel data.
- **Pulsoid / HypeRate** — your heart-rate stream (your token / API key).
- **Spotify** — controlled locally via OS media keys (no Spotify account data is read).
- **Leppsoft Soundpad** — controlled locally via its remote-control pipe.
- **Weather** — a city name you choose is sent to Open-Meteo (no account, no key).
- **AI providers** (OpenAI, Ollama, LiteLLM, Gemini, Grok, Groq, OpenRouter,
  Anthropic, or a custom endpoint) — only the chatbox text you choose to send.

Each of these services has its own privacy policy and terms, which govern the data
you exchange with them. We are not responsible for their handling of your data.

## 5. Now Playing
The "Now Playing" feature reads the currently playing media title/artist from your
Windows media session locally to display it. This information is only sent where you
direct it (your VRChat chatbox / KAT / overlay / Discord presence) and is never sent
to us.

## 6. No selling of data
We do not sell, share, or monetize any data. We have none to sell.

## 7. Children
The App is not directed at children under the age required by the third-party
platforms you connect to.

## 8. Changes
We may update this policy; the "Effective date" above will change accordingly.

## 9. Contact
For privacy questions, contact NekoSuneVR via the project's official channels, or open
an issue at <https://github.com/NekoSuneProjects/NekoSuneOSC/issues>.
