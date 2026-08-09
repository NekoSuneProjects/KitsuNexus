# Song recognition providers

`shazamOscModule.js` owns desktop-audio capture, live recognition scheduling, bass OSC,
history and chatbox behavior. `songRecognition.js` runs provider requests in the main
process and normalizes every result to one shape.

Provider modes:

1. **AudD** — official `@audd/sdk`, MIT, requires an AudD token.
2. **ACRCloud** — `acrcloud`, MIT, requires host, access key and access secret.
3. **node-shazam** — optional external fallback. It is GPL-2.0 and is intentionally not
   installed or bundled by KitsuNexus. The adapter activates only when the package is
   separately available at runtime.
4. **Automatic fallback** — tries only configured providers, in the order above.

Provider secrets are passed only to the selected service. Never log request objects or
raw credentials. A no-match result is successful and should not automatically consume a
second provider request; fallbacks are reserved for provider errors/unavailability.

Developers who intentionally accept node-shazam's GPL-2.0 terms can keep it outside this
project with:

```powershell
npm install --prefix "$env:APPDATA\KitsuNexus\optional-providers" node-shazam
```

Alternatively set `NEKOSUNE_NODE_SHAZAM_PATH` to an external package folder. Do not add it
to this repository's dependencies or installer payload.
