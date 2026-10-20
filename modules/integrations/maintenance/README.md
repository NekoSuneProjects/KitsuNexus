# Maintenance integrations

- `updater.js` reads official GitHub release metadata through the configured KitsuNexus server's
  public `/api/desktop/updates/latest` endpoint. Older or offline servers fall back to the
  GitHub Releases API; installers are still restricted to verified GitHub release downloads.
  `serverConfig.js` also retrieves the read-only Discord Rich Presence Application ID from the
  server's `/api/desktop/config` endpoint, falling back to the bundled official ID offline.
  The updater hands updates to the separately packaged
  `%LOCALAPPDATA%\KitsuNexus-updater\Update.exe` helper. The bundled updater is copied and
  compared by MD5 on every app launch; a changed binary is staged and verified before replacing
  it. A running locked updater uses the verified staged executable until the next launch, and
  the old `%LOCALAPPDATA%\KitsuNexus\Update.exe` copy is cleaned up when possible.
  Update details are passed through a private environment payload with Electron-only shell
  overrides removed. A two-way ready/ack handshake in a shared directory keeps the main app
  open until the helper's real window is alive; the helper then remains running
  to install and relaunch KitsuNexus. On Windows, it launches NSIS through Windows ShellExecute
  semantics so the installer's own manifest handles UAC, preserves `/D=` paths containing spaces,
  and waits for the installed files to finish writing before reporting success.
- `vrNotify.js` connects the app to the optional Windows notification package.
