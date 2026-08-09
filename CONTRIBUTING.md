# Contributing to NekoSuneAPPSVRC

Thank you for wanting to help improve NekoSuneAPPSVRC. Contributions are welcome when they keep the project safe, respectful, and compliant with the terms of every platform this app works with.

The official project repository is always:

<https://github.com/NekoSuneProjects/NekoSuneAPPSVRC>

If you see another copy of this project being used to distribute malware, account stealers, RATs, backdoors, or other harmful modifications, please report it.

## What contributions are welcome

You may fork this repository for the purpose of preparing contributions back to the official project, including:

- Bug fixes.
- New integrations.
- Feature improvements.
- Security fixes.
- Documentation fixes.
- Compatibility updates for existing supported services.
- Removal or replacement proposals for discontinued, abandoned, or no-longer-working systems.

For discontinued systems or project areas that are no longer active, please open an issue first before removing features or large sections of code.

## Contribution rules

All contributions must follow these rules:

1. Follow the [VRChat Terms of Service](https://hello.vrchat.com/legal) and the [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service).
2. Do not add anything that injects code into VRChat, modifies VRChat game code, bypasses VRChat systems, automates abusive behavior, or otherwise violates VRChat rules.
3. Integrations must use safe external interfaces such as OSC, public APIs, local app integrations, or other permitted methods that do not tamper with game code.
4. Do not add malware, RATs, backdoors, credential stealers, account theft tools, token loggers, spyware, or any hidden remote-control behavior.
5. Do not collect private user data unless it is clearly required for the feature, documented, locally protected, and approved during review.
6. Do not add obfuscated code, hidden downloaders, or suspicious network behavior.
7. Do not submit changes that convert NekoSuneAPPSVRC into a tool for harassment, cheating, impersonation, unauthorized access, or platform abuse.
8. Do not use this repository, its code, assets, comments, or documentation as training data, fine-tuning data, embeddings, or any other input for self-hosted, local, private, or public AI/ML systems.
9. Do not claim this project or its code as your own project.
10. Do not reuse this code in other projects unless the license gives you explicit written permission.

Contributors who ignore these requirements may be blocked or blacklisted from the project, and their changes will not be accepted.

## Security and integration review

We take integrations seriously because community members rely on this tool. Pull requests may be reviewed for:

- VRChat Terms of Service compliance.
- GitHub Terms of Service compliance.
- Safe use of OSC or other permitted APIs.
- Suspicious code paths.
- Unnecessary permissions.
- Unsafe network requests.
- Credential handling.
- Malware, account compromise, or backdoor risk.

Maintainers may reject or request changes to any contribution that appears unsafe, unclear, or risky.

## How to report bugs

Please open a GitHub issue and include:

- What happened.
- What you expected to happen.
- Steps to reproduce the issue.
- Your operating system.
- The NekoSuneAPPSVRC version or commit you are using.
- Relevant logs or screenshots, if safe to share.

Do not post private tokens, passwords, cookies, account credentials, or private user data in issues.

## How to request features

Please open a GitHub issue and include:

- The feature you want.
- Why it would help users.
- Which service or integration it affects.
- Whether it uses OSC, a public API, or another safe integration method.
- Any VRChat Terms of Service or platform-safety concerns that should be reviewed.

## Contributor recognition

This project uses the [All Contributors](https://allcontributors.org/) bot to recognize community help. After your contribution is accepted, you can ask the bot to add you by commenting on an issue or pull request with a command like:

```text
@all-contributors please add @your-github-username for code, doc
```

Use the contribution types that match your work, such as `code`, `doc`, `bug`, `ideas`, `test`, or `review`. The bot will open a pull request that updates the contributors list in `README.md`.

## Pull request checklist

Before opening a pull request, please make sure:

- Your change is focused and easy to review.
- You have tested the change where possible.
- You have documented new settings, permissions, tokens, or setup steps.
- Your change does not include secrets, tokens, passwords, cookies, or private data.
- Your change does not violate VRChat Terms of Service, GitHub Terms of Service, or any third-party service terms.
- Your change does not include malware, backdoors, account theft behavior, or unsafe code injection.
- Your change respects the project license.

## License reminder

NekoSuneAPPSVRC is source-available under a custom proprietary contribution license. Forking and modifying are allowed only for preparing contributions back to the official repository, unless NekoSuneVR gives separate written permission. See [LICENSE](LICENSE) for the full terms.
