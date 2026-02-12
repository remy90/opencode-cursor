# Go Cobra CLI: `open-cursor`

This repo currently ships:
- A Go TUI installer (`cmd/installer`)
- An npm package (`@rama_nigg/open-cursor`) that contains the plugin bundle and a Node-based installer CLI (invokable via `npm exec -- @rama_nigg/open-cursor install`)

The next step is a first-class Go Cobra CLI with consistent `open-cursor` branding, shared install logic, and a clean path toward a “just works” npm install.

## Branding

Print this ASCII header at startup (root command help and `open-cursor version`):

```text
 ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ ▄▄  ▄▄      ▄▄▄  ▄▄ ▄▄ ▄▄▄▄   ▄▄▄▄   ▄▄▄   ▄▄▄▄ 
██ ██ ██ ██ ██▄▄  ███▄██ ▄▄▄ ██ ▀▀ ██ ██ ██ ██ ██▄▄▄  ██ ██  ██ ██
▀█▄█▀ ██▀▀  ██▄▄▄ ██ ▀██     ▀█▄█▀ ▀█▄█▀ ██▀█▄ ▄▄▄█▀  ▀█▄█▀  ██▀█▄
```

Source: `/home/nomadx/bit/opencursor.txt`.

Reference implementation style: `/home/nomadx/Documents/jellywatch/cmd/jellywatch/main.go`.

## CLI UX (v1)

Binary name: `open-cursor`

Commands:
- `open-cursor install` (idempotent)
  - Configure OpenCode for Cursor in one step. This is safe to re-run any time.
  - Ensure plugin file exists: `~/.config/opencode/plugin/cursor-acp.js` (or XDG equivalent)
  - Ensure provider config exists/merged in `opencode.json` (baseURL + models)
  - Sync models from `cursor-agent models` into the config (no separate script required)
  - Best-effort ensure `@ai-sdk/openai-compatible` is installed in `~/.config/opencode`
- `open-cursor sync-models`
  - Run `cursor-agent models`, update provider models in config
- `open-cursor status`
  - Print config path, plugin path, provider enabled, baseURL, model count
  - Optional `--json` output for scripts
- `open-cursor uninstall`
  - Remove plugin link and provider entry (with backup)
- Optional (later): `open-cursor doctor`
  - Validate cursor-agent presence, login state, and common misconfigurations

Flags (keep v1 simple):
- `--config <path>` default `$XDG_CONFIG_HOME/opencode/opencode.json` (else `~/.config/opencode/opencode.json`)
- `--plugin-dir <path>` default `$XDG_CONFIG_HOME/opencode/plugin`
- `--copy` copy plugin-entry instead of symlink
- `--no-backup`

Advanced (optional; only add if needed):
- `--base-url <url>` override proxy baseURL (default `http://127.0.0.1:32124/v1`).
  Rationale: users running the proxy on a different host/port.
- `--skip-models` skip `cursor-agent models` (useful for CI or offline installs).

Backups:
- Always create `<config>.bak.<timestamp>` unless `--no-backup`.

## Architecture (avoid duplication)

Refactor the existing Go installer logic so both the TUI installer and Cobra CLI share the same core code.

Proposed packages:
- `internal/opencodeconfig`
  - Read/write config
  - Backup config
  - Ensure provider `cursor-acp` exists and is merged (preserve user fields)
  - Ensure plugin array includes `cursor-acp`
- `internal/cursoragent`
  - Run `cursor-agent models`
  - Parse model list into a stable shape
- `internal/pluginlink`
  - Create plugin symlink/copy at `.../opencode/plugin/cursor-acp.js`
  - Resolve plugin entry source:
    - source install: `<repo>/dist/plugin-entry.js`
    - npm install: `node_modules/.../dist/plugin-entry.js` if applicable
- `internal/installsteps`
  - Composed operations: Install, SyncModels, Status, Uninstall

Then:
- Cobra CLI lives in `cmd/open-cursor`
- TUI installer (`cmd/installer`) becomes a UI wrapper over `internal/installsteps`

## NPM Distribution Strategy (later)

Today’s npm flow works via Node and `npm exec`.

Longer-term:
- Publish prebuilt `open-cursor` binaries to GitHub Releases (darwin/linux, amd64/arm64).
- Add npm `postinstall` downloader that installs the appropriate binary into the package directory.
- Expose that binary via npm `bin` (thin JS shim that execs the binary).
- Keep Node installer as fallback if binary download fails.

## Testing (minimum)

Add a small integration test harness in Go:
- run `open-cursor install --config <tmp>/opencode.json --plugin-dir <tmp>/plugin`
- assert:
  - plugin file exists
  - provider entry exists with models
  - backups are created unless `--no-backup`

## Versioning / Publishing

Do not publish to npm for docs-only changes.
Only publish when user-facing behavior changes (plugin behavior, installer behavior, CLI behavior).
