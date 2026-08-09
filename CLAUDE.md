# KitsuNexus — Instructions for Claude

This file is read automatically by Claude Code at the start of every session in this repo.
Anyone working on this project with Claude (NekoSuneVR, FumikoEcho, etc.) gets these same rules
without having to repeat them.

## Always keep these three in sync

1. **[TODO.md](TODO.md)** — as soon as a feature/fix discussed or implemented in the session is
   actually done, check it off (`[ ]` → `[x]`, or `[~]` if only partially done) or add a new line
   for it if it isn't tracked yet. Do this as you go, not just at the end.
2. **[CHANGELOG.md](CHANGELOG.md)** — every notable change (feature, fix, removal) made during a
   session gets an entry under `## Unreleased` at the top, in the same style as existing entries:
   a bold one-line summary, then a short paragraph explaining root cause/behavior for fixes, or
   what the feature does for additions. Group under `### Added` / `### Fixed` / `### Removed` /
   `### Known issues` as appropriate. Do this per change, not batched at the end of a long session.
3. **`package.json` `version`** — do **NOT** bump this on every change. Only bump it when the
   user says the branch/session is done and says a variant of **"commit and push"** (i.e. all
   fixes/features for this round are finished and ready to ship). At that point:
   - Bump `version` in `package.json` (patch bump, e.g. `1.0.59` → `1.0.60`, unless told otherwise).
   - Move the `## Unreleased` changelog entries into a new `## [x.y.z] - YYYY-MM-DD` section
     (use today's actual date), leaving `## Unreleased` empty above it for the next round.
   - Then commit and push as instructed.

## Always be looking for bugs, UI issues, and crashes

Don't limit review to the specific lines being touched. Whenever working in a file or feature
area:
- Actively look for bugs, broken UI/layout, and anything that could crash the app — not just the
  thing you were asked to fix.
- Double-check the app still works as expected after a change (relevant tab/feature loads,
  no console errors, no obvious regression) — don't just assume the edit is correct because it
  compiles.
- If you find something wrong that's out of scope for the current task, don't silently ignore it
  and don't silently fix it as a surprise side-quest either — add it to [TODO.md](TODO.md) so it's
  tracked, and say so.

## Always check for malicious code before adding dependencies or files

Before adding a new npm package, or any external file/script/snippet from outside the repo, check
it for malware/backdoors/supply-chain risk first:
- New npm packages: check for typosquatting (name close to a popular package), a suspiciously
  recent publish date with high version numbers, obfuscated/minified postinstall scripts, or a
  maintainer/publish history that doesn't match the package's popularity. Prefer well-known,
  widely-used packages over obscure ones that do the same thing.
- Any external file or code snippet being pulled into the repo: read it before adding it — don't
  paste in obfuscated code, unexplained base64 blobs, or scripts that phone home, without
  understanding what they do first.
- If anything looks suspicious, stop and flag it to the user instead of adding it.

## Git workflow

- **Always `git pull` first** before starting work in a session, so changes are based on the
  latest `main` (FumikoEcho and NekoSuneVR both push to this repo — don't work from a stale copy).
- **Always `git fetch` from [NekoSuneProjects/KitsuNexus](https://github.com/NekoSuneProjects/KitsuNexus)
  for whatever branch you're currently on**, not just `main` — if working on a feature/fix branch,
  fetch and sync that branch with its remote counterpart too before continuing, so you're never
  working against stale state on any branch.
- **Always test the code before pushing anything to GitHub** — run/launch the app and exercise the
  affected feature(s), and check for obvious errors, not just that it compiles. Don't push
  untested changes.
- **Only tag for an actual version release, never otherwise.** `.github/workflows/build.yml`
  triggers the whole build/publish/Discord-announce pipeline off `v*` tags, so a version
  release genuinely needs one (`vX.Y.Z`, pushed with the version-bump commit). Don't create
  tags for anything else (docs commits, mid-session fixes, etc.).
- **Always open a Pull Request** to [NekoSuneProjects/KitsuNexus](https://github.com/NekoSuneProjects/KitsuNexus)
  for the changes, rather than just committing/pushing straight to `main` with nothing to review.
  Every PR must have a real description of what changed and why — **never leave the PR description
  blank**.

## Why this file exists

FumikoEcho and NekoSuneVR both work on this repo through Claude Code. Instead of re-explaining
this workflow in every conversation, it's written down once here so either person gets the same
behavior automatically.
