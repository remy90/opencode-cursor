# OpenCode-Cursor: AI SDK Provider Implementation

## What's Fixed

This project has been completely rewritten to use the **correct AI SDK provider pattern** instead of the broken OpenCode plugin approach.

### Key Changes

**Before (Broken):**
- Used `@opencode-ai/plugin` SDK (wrong pattern for providers)
- Attempted to create HTTP bridge (unnecessary complexity)
- Configured `http://127.0.0.1:32123/v1` but no server existed

**After (Fixed):**
- Uses `@ai-sdk/provider` SDK (correct pattern)
- Creates proper `LanguageModel` instances
- Uses `customProvider()` function to register as provider
- Works with OpenCode's internal HTTP proxy system
- Leverages existing `SimpleCursorClient` for cursor-agent communication
- No HTTP server needed - AI SDK handles HTTP proxy internally

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    OpenCode                            │
│                                                         │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Provider System (@ai-sdk/provider)       │    │
│  │                                            │    │
│  │  ┌──────────────────────────────────────┐    │    │
│  │  │  cursorProvider (@ai-sdk/provider)   │    │
│  │  │  - Implements customProvider()       │    │
│  │  │  - Wraps SimpleCursorClient         │    │
│  │  │  - Returns LanguageModel objects    │    │
│  │  └──────────────────────────────────────┘    │
│  └──────────────────────────────────────────────────┘    │
│                      │    │
│  ▼ Request from User                     │    │
│              │    │
│  ┌──────────────────────────────────────────┐    │
│  │  cursor-agent (subprocess)             │    │
│  │  - Spawned via SimpleCursorClient   │    │
│  │  - Communicates via stdin/stdout      │    │
│  └───────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **OpenCode** requests model: `cursor-acp/gpt-5.1`
2. **AI SDK** calls `cursorProvider.languageModel("cursor-acp/gpt-5.1")`
3. **Provider** calls `SimpleCursorClient.executePrompt()`
4. **Client** spawns `cursor-agent` with stdin/stdout
5. **Cursor Agent** returns JSON output
6. **Provider** converts to AI SDK format and returns text

---

## Usage

### Installation

**Automated Installation:**
```bash
# Quick install (recommended)
npm install opencode-cursor
```

The npm package automatically:
- Installs the provider to OpenCode's package.json
- Adds cursor-acp provider configuration
- No manual configuration needed

### Models Available

All Cursor Agent models are available:

- `cursor-acp/auto` - Automatic model selection
- `cursor-acp/gpt-5.1` - GPT-5.1
- `cursor-acp/gpt-5.2` - GPT-5.2
- `cursor-acp/claude-4.5-sonnet` - Claude 4.5 Sonnet
- `cursor-acp/claude-4.5-sonnet-thinking` - Claude 4.5 Sonnet Thinking
- `cursor-acp/claude-4.5-opus` - Claude 4.5 Opus
- `cursor-acp/claude-4.5-haiku` - Claude 4.5 Haiku
- `cursor-acp/gemini-3-flash` - Gemini 3 Flash
- `cursor-acp/gemini-3-pro` - Gemini 3 Pro
- `cursor-acp/deepseek-v3.2` - DeepSeek V3.2
- `cursor-acp/composer-1` - Cursor Composer 1
- `cursor-acp/grok-4` - Grok 4
- `cursor-acp/kimi-k2` - Kimi K2
- And 21 more models

### Example: OpenCode Config

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "default": {
      "model": "cursor-acp/gpt-5.1"
    }
  }
}
```

### Example: Programmatic Usage

```typescript
import { generateText } from "ai";

const result = await generateText({
  model: "cursor-acp/gpt-5.1",
  prompt: "Write a function to add two numbers",
});

console.log(result.text);
```

---

## Building for Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test changes
npm test
```

---

## Implementation Details

- **File**: `src/provider.ts` - Complete rewrite using `@ai-sdk/provider`
- **Client**: `src/client/simple.ts` - Unchanged, wraps cursor-agent
- **Config**: Uses `SimpleCursorClient` directly
- **No HTTP server needed** - AI SDK handles HTTP proxy internally
- **No plugin hooks needed** - Provider pattern is correct approach

---

## License

ISC

## Installation

```bash
npm install opencode-cursor
```

The npm package automatically:
- Installs provider to OpenCode's package.json
- Adds cursor-acp provider configuration
- No manual configuration needed
