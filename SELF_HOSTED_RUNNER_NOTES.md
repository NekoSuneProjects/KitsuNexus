# Self-hosted runner notes for release packaging

This repository's packaging workflow is designed for one AMD64 Ubuntu self-hosted runner with the labels `self-hosted`, `Linux`, and `X64`.

## Runner version requirement

The workflow uses current official GitHub Actions majors such as `actions/checkout@v5`, `actions/setup-node@v7`, `actions/cache@v5`, `actions/upload-artifact@v6`, and `actions/download-artifact@v8`. These Node 24-based actions require a self-hosted runner new enough to run Node 24 actions. Keep the runner updated; runner `2.336.0` is new enough for these actions.

## About repeated AAD / RSA log lines

Logs like these are normally runner listener diagnostics, not build failures:

```text
INFO RSAFileKeyManager Loading RSA key parameters from file .../.credentials_rsaparams
INFO GitHubActionsService AAD Correlation ID for this token request: Unknown
WARN GitHubActionsService Retrieving an AAD auth token took a long time (... seconds)
```

They mean the runner process is loading its stored RSA credentials and polling GitHub's broker service for jobs. A brief `Retrieving an AAD auth token took a long time` warning usually indicates a slow network/auth request and is only actionable if the runner repeatedly fails to pick up jobs.

## About `TaskCanceledException` after Ctrl-C

The log block below is expected when the runner is stopped with Ctrl-C or the terminal session closes while the listener is waiting for GitHub's next message:

```text
INFO Runner Received Ctrl-C signal, stop Runner.Listener and Runner.Worker.
WARN GitHubActionsService GET request to https://broker.actions.githubusercontent.com/message?... has been cancelled.
ERR BrokerServer System.Threading.Tasks.TaskCanceledException: The operation was canceled.
```

That is a controlled shutdown, not a workflow bug. To keep the single self-hosted node available for release builds, run the runner as a service instead of an interactive terminal process.

## Recommended Ubuntu service setup

From the runner directory, run the service commands supplied by the GitHub runner package:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

Useful service maintenance commands:

```bash
sudo ./svc.sh stop
sudo ./svc.sh uninstall
```

If the runner still disconnects, check the systemd journal for the runner unit and verify outbound HTTPS connectivity to GitHub Actions endpoints.

## Package dependencies expected by the workflow

The workflow installs its packaging dependencies automatically with `apt-get`, including Wine for Windows cross-builds and NSIS when Ubuntu provides it. The self-hosted runner user still needs passwordless `sudo` for those install steps, or the packages must be preinstalled on the host.
