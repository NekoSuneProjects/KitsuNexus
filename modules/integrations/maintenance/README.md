# Maintenance integrations

- `updater.js` checks KitsuNexus GitHub releases and hands updates to the separately packaged
  `%LOCALAPPDATA%\KitsuNexus\Update.exe` helper. Update details are passed through a private
  environment payload with Electron-only shell overrides removed. A two-way ready/ack handshake
  keeps the main app open until the helper's real window is alive; the helper then remains running
  to install and relaunch KitsuNexus. On Windows, it launches NSIS through Windows ShellExecute
  semantics so the installer's own manifest handles UAC, preserves `/D=` paths containing spaces,
  and waits for the installed files to finish writing before reporting success.
- `vrNotify.js` connects the app to the optional Windows notification package.
