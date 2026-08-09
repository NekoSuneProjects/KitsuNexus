# NekoAvatarLocker integration

This module ports the desktop features from the sibling `NekoAvatarLocker` project into
NekoSuneAPPSVRC:

- Ed25519 verification of signed `.nalown` ownership packages;
- an encrypted vault stored in NekoSuneAPPSVRC AppData;
- Locked, Partial, and Unlocked OSC states plus per-group parameters;
- ownership import/export and creator template signing;
- optional migration of the original desktop app's encrypted vault.

Do not copy `creator.private.pem`, creator key directories, release output, or example
ownership packages into this repository. Creator keys generated from the UI stay under
the current user's AppData folder.
