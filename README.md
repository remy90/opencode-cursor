# opencode-cursor

A lightweight OpenCode plugin for Cursor Agent integration via stdin (fixes E2BIG errors).

## Problem Solved

`opencode-cursor-auth` passes prompts as CLI arguments → causes `E2BIG: argument list too long` errors.

This plugin uses stdin/stdout to bypass argument length limits.

## Installation

```bash
cd ~/.config/opencode/plugin
ln -s /home/nomadx/opencode-cursor/src/cursor-acp.js cursor-acp.js
```

## Configuration

Add to `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "cursor-acp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor Agent (ACP stdin)",
      "options": {
        "baseURL": "http://127.0.0.1:32123/v1"
      }
    }
  }
}
```

## Usage

OpenCode will automatically use this provider when configured.

## Features

- ✅ Passes prompts via stdin (fixes E2BIG)
- ✅ Full streaming support
- ✅ Tool calling support
- ✅ Minimal complexity (~200 lines)
- ✅ No custom HTTP proxy layer

## Why Not PR #5095?

PR #5095 exists but hasn't merged. This is a lightweight alternative until native ACP support lands.

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Watch mode
bun run dev
```

## License

ISC
