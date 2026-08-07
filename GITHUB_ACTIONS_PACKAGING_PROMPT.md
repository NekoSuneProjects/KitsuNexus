# Portable desktop app packaging prompt for GitHub Actions

Use this prompt in another project when you want an assistant (Claude, Codex, etc.) to update a GitHub Actions release workflow without guessing your current setup.

```text
You are editing my repository's GitHub Actions release/build workflow.

Before changing anything:
1. Ask me to paste the current workflow YAML, package/build config, and package manager files.
2. Explain every change you plan to make and why.
3. Wait for my approval before modifying files.
4. Search current official docs or project docs to confirm what packaging targets are supported for my framework/tooling. If the project is not Electron, first identify the app type and supported packaging tools instead of assuming Electron Builder.

Goal:
- Keep my existing release process where possible: same triggers, release notes, release upload, and notification steps unless they need small updates for new artifact names.
- Run every build on one AMD64 Ubuntu self-hosted runner only, using `runs-on: [self-hosted, Linux, X64]`.
- Use a GitHub Actions matrix with these logical targets:
  - `win-x64`
  - `linux-x64`
  - `linux-arm64`
- Cross-build Windows from AMD64 Ubuntu when the project supports it.
- Auto-install build dependencies on Ubuntu, including Wine and NSIS if Windows installers are supported.
- Cache package-manager downloads and app-builder downloads. For Electron/Electron Builder, cache npm plus `~/.cache/electron` and `~/.cache/electron-builder`.
- Use the latest stable official GitHub Actions major versions that work with current self-hosted runners. Mention minimum runner version requirements if using Node 24-based actions.
- Upload all artifacts from every matrix leg.

For Electron Builder projects, configure or preserve these targets when supported:
- Windows x64:
  - portable `.exe`
  - NSIS setup `.exe`
- Linux x64:
  - `.AppImage`
  - `.tar.gz`
- Linux arm64:
  - `.AppImage`
  - `.tar.gz`

For non-Electron projects:
- Research supported packagers for the detected stack (for example Tauri, Flutter, .NET, Rust, Go, Python, Java, or web-only projects).
- If a requested artifact type is unsupported, explain that clearly and propose the nearest practical equivalent.
- Do not add random third-party packagers without checking maintainership, release history, and install scripts for supply-chain risk.

Implementation requirements:
- Prefer `npm ci`, `pnpm install --frozen-lockfile`, `yarn --immutable`, or the equivalent lockfile-safe install.
- Do not wrap imports in try/catch blocks.
- Ensure Windows artifacts can build on Ubuntu with Wine where the packager supports it.
- Keep release publication conditional on tags if that is how the current workflow releases.
- Keep artifact names architecture-specific so users can tell x64 from arm64.
- Include update metadata files (`latest*.yml`, `.blockmap`, etc.) if the current release/updater process uses them.
- Validate the workflow YAML and package config after editing.
- Commit the changes on the current branch and open a pull request with a clear title/body if the environment provides PR tooling.

Please produce:
1. A summary of exactly what changed.
2. A list of commands/tests/checks you ran.
3. Any limitations, especially cross-build support that depends on the framework.
```
