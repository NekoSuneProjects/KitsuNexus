# NekoSuneAPPSVRC — Instructions for Codex

This is Codex's counterpart to [CLAUDE.md](CLAUDE.md). Work on this repo bounces between Claude
(code/logic) and Codex (icons/images), so read this file at the start of any session here.

## Your job: icons / images

- When asked to create or update an icon/image, generate it and save it to the location given in
  the prompt.
- If no location is given, default to `assets/icons/`, following the existing convention
  documented in [assets/icons/README.md](assets/icons/README.md):
  - 256×256 px, transparent background, solid white (#FFFFFF) flat line icon, consistent
    2px-equivalent stroke weight, no text/shadow/background shape.
  - Use the **master style prompt** at the top of that README, only changing the "Subject:" part.
  - File name is `<tab-name>.png` (`.svg` also works, png tried first) — match the naming already
    used in the README's table.
- After adding or changing an icon file, update the table in `assets/icons/README.md` (add a new
  row for a new icon, or note the change) so it stays the source of truth for what exists and why.
- If a request is ambiguous about which tab/feature an icon is for, ask rather than guessing a
  file name.

## [TODO-ICONS.md](TODO-ICONS.md) — your own todo list

- This is your working todo list for icon/image tasks, separate from `TODO.md` (which is Claude's
  code-level todo list).
- Track missing icons, planned icons, and in-progress work here. Check items off as you finish
  them, and add new lines as soon as a new icon need shows up (e.g. a new sidebar tab that has no
  matching file in `assets/icons/` yet).
- Keep it truthful — if a file already exists in `assets/icons/`, don't list it as outstanding.

## Working alongside Claude

- Claude owns `CLAUDE.md`, `CHANGELOG.md`, `TODO.md`, and `package.json` version bumps — you don't
  need to maintain those, but if an icon you add is the last missing piece of something Claude has
  listed in `TODO.md`, feel free to check that line off too.
- Same security rule as Claude's file: don't pull in outside images/scripts/assets without
  checking them first — no embedded scripts in SVGs you didn't write yourself, no files from
  untrusted sources.
