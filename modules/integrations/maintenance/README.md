# Maintenance integrations

- `updater.js` checks KitsuNexus GitHub releases and hands updates to the separately packaged
  `%LOCALAPPDATA%\KitsuNexus\Update.exe` helper. The main app exits only after that helper confirms
  it spawned successfully; the helper remains alive to install and relaunch KitsuNexus.
- `vrNotify.js` connects the app to the optional Windows notification package.
