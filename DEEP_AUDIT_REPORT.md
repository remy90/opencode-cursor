# OpenCode-Cursor: Deep Audit & Improvement Plan

**Date**: 2026-01-28
**Status**: System broken - no working path to Cursor integration

---

## Executive Summary

**Critical Finding**: The project is **completely non-functional**. There's a fundamental architectural mismatch between what OpenCode expects (HTTP providers) and what the code implements (direct stdin/stdout).

**The Problem**:
- Installer configures: `baseURL: "http://127.0.0.1:32123/v1"`
- Plugin implements: Direct stdin/stdout communication with cursor-agent
- **No server exists on port 32123**
- **Result**: OpenCode makes HTTP requests → Connection refused → Plugin fails

**The Reality**: After extensive research, **there is NO documented way to bypass HTTP for OpenCode providers**. The Provider type requires an npm package that implements HTTP endpoints.

---

## Architecture Analysis

### Current (Broken) Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode                        │
│  ┌──────────────────────────────────────────┐      │
│  │  Provider Config (opencode.json)  │      │
│  │  "cursor-acp": {                    │      │
│  │    npm: "@ai-sdk/openai-compatible" │      │
│  │    options: {                        │      │
│  │      baseURL: "http://127.0.0.1:32123/v1"  │
│  │    }                                 │      │
│  │  }                                   │      │
│  └──────────────────────────────────────────┘      │
│                      │                            │
│  ▼ HTTP Request                                 │
│  ┌───────────────────┐                      │
│  │  127.0.0.1:32123                         │
│  │  ❌ NO SERVER  │                      │
│  └───────────────────┘                      │
│                                                  │
│                                                  │
┌──────────────────────────────────────────────┐     │
│  cursor-agent (subprocess)                │     │
│  ✓ Working correctly via stdin/stdout    │     │
└──────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### What Actually Exists in Code

**Two parallel implementations (both unused)**:

1. **`src/core/provider.ts` + `src/client/simple.ts`**:
   - Uses `@opencode-ai/plugin` SDK
   - Spawns cursor-agent via stdin/stdout
   - Returns `LanguageModelV1` objects
   - ❌ **BUT OpenCode calls this as a provider, which requires HTTP**

2. **`src/client/agent.ts` + `src/index.ts`**:
   - Uses `@agentclientprotocol/sdk` (ACP)
   - Implements full ACP protocol
   - Manages sessions, tools, retries
   - ❌ **BUT this is for being an AGENT, not a PROVIDER**

---

## Critical Issues Found

### 1. **CRITICAL: Missing HTTP Server** 🔴

**Severity**: BLOCKING - Project cannot function

**Issue**:
```bash
# Config says:
"options": { "baseURL": "http://127.0.0.1:32123/v1" }

# But nothing runs on port 32123
$ curl http://127.0.0.1:32123/v1
curl: (7) Failed to connect to 127.0.0.1 port 32123: Connection refused
```

**Root Cause**: No implementation of HTTP bridge between OpenCode's HTTP requests and cursor-agent's stdin/stdout.

**Impact**: Complete failure - users cannot use Cursor models through OpenCode.

---

### 2. **Architectural Confusion** 🔴

**Issue**: Code has two competing implementations for different purposes:

| Implementation | Purpose | Used | Correct? |
|---------------|---------|-------|-----------|
| `src/core/provider.ts` | OpenCode provider (HTTP) | No | Wrong architecture |
| `src/client/agent.ts` | ACP agent (for Zed/JetBrains) | No | Wrong project scope |
| `src/client/simple.ts` | Direct cursor-agent wrapper | No | No integration point |

**Problem**: None of these integrate with OpenCode's provider system correctly.

---

### 3. **Installer Misconfiguration** 🔴

**Location**: `cmd/installer/tasks.go:205-209`

**Issue**:
```go
providers["cursor-acp"] = map[string]interface{}{
    "npm":  "@ai-sdk/openai-compatible",
    "name": "Cursor Agent (ACP stdin)",
    "options": map[string]interface{}{
        "baseURL": "http://127.0.0.1:32123/v1",
    },
    "models": models,
}
```

**Problem**: Configures a baseURL that doesn't exist. OpenCode will attempt HTTP requests to this URL and fail.

---

### 4. **Incorrect Provider Type** 🟡

**Location**: `src/core/provider.ts`

**Issue**:
```typescript
export const createCursorProvider = (config: CursorProviderConfig = {}) => {
  return new CursorProvider();
};

// This creates a Provider object but OpenCode expects:
// - npm: "@ai-sdk/openai-compatible" (which makes HTTP requests)
// OR - A direct plugin export (hooks)
```

**Problem**: The provider pattern requires implementing LanguageModelV1 with HTTP communication. Cannot use stdin/stdout.

---

### 5. **Installer Issues** 🟡

**Minor Issues**:
- No validation that `@ai-sdk/openai-compatible` is installed
- Backup system is good but doesn't validate config before writing
- `verifyPostInstall` task is optional - runs `opencode models` but timeout is too aggressive (5s)

**Found in `cmd/installer/tasks.go`**:
```go
// Line 270-272
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
// 5 seconds is too short for opencode models to start
```

---

### 6. **Missing Error Handling** 🟡

**Location**: `src/client/simple.ts`

**Issue**:
```typescript
// Line 164-165: Timeout doesn't actually kill process
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
  reject(new Error(`Timeout after ${this.config.timeout}ms`));
}, this.config.timeout);
```

**Problem**: If cursor-agent is blocked (e.g., waiting for user input), SIGTERM might not work without SIGKILL fallback.

---

### 7. **Test Coverage** 🟢

**Status**: Tests are placeholders

```typescript
// tests/integration/agent.test.ts
describe("CursorAcpHybridAgent Integration", () => {
  it("should initialize with ACP capabilities", async () => {
    expect(true).toBe(true);  // Not testing anything!
  });
});
```

**Impact**: No way to verify fixes work correctly.

---

## Research Findings: OpenCode Provider Architecture

### What OpenCode Requires

After researching `@opencode-ai/plugin` SDK, `@opencode-ai/sdk`, and community implementations:

**Providers MUST use HTTP**:

```typescript
// OpenCode's Provider type (from @opencode-ai/sdk/dist/gen/types.gen.d.ts)
export type Provider = {
    id: string;
    name: string;
    source: "env" | "config" | "custom" | "api";
    env: Array<string>;
    key?: string;
    options: {
        [key: string]: unknown;  // HTTP options like baseURL, headers
    };
    models: {
        [key: string]: Model;
    };
};

// Model type includes API endpoint
export type Model = {
    id: string;
    providerID: string;
    api: {
        id: string;
        url: string;  // HTTP URL
        npm: string;  // npm package that implements HTTP
    };
    // ...
};
```

**Key Insight**: The `api.npm` field points to an npm package that **MUST implement HTTP endpoints**. OpenCode will fetch models from this npm package.

---

### Community Approach: `@ai-sdk/openai-compatible`

This is the reference implementation for OpenAI-compatible HTTP providers:

**What it does**:
- Implements HTTP endpoints (standard OpenAI API format)
- Receives HTTP requests from OpenCode
- Returns streaming responses via SSE (Server-Sent Events)
- Provides `createOpenAICompatible()` factory function

**OpenCode usage**:
```yaml
# opencode.json
provider:
  my-provider:
    npm: "@ai-sdk/openai-compatible"
    options:
      baseURL: "https://api.example.com/v1"
    models:
      gpt-4: { name: "GPT-4" }
```

---

### Alternative: Plugin Hooks (Experimental)

**NOT RECOMMENDED**: The `@opencode-ai/plugin` SDK supports hooks like `chat.params`, `chat.message`, but:

**Problem**: These hooks are for MODIFYING requests to OTHER providers, not for providing models directly.

```typescript
// This HOOKS into OpenCode's chat flow
const plugin: Plugin = async ({ client, $ }) => {
  return {
    "chat.params": async (input, output) => {
      // Can modify temperature, options
      // CANNOT provide model response
      output.options = { temperature: 0.7 };
    },
  };
};
```

**Conclusion**: Plugin hooks cannot replace provider HTTP mechanism.

---

### Research Verdict: HTTP is MANDATORY

**After exhaustive search**:
- ❌ No documentation on bypassing HTTP
- ❌ No examples of non-HTTP providers
- ❌ AI SDK docs all show HTTP-based providers
- ✅ All successful community providers implement HTTP

**Conclusion**: HTTP server is **unavoidable** for OpenCode providers.

---

## Cursor Integration Analysis

### What Exists (Correct Implementation)

Both cursor integration implementations correctly use stdin/stdout:

**`src/client/simple.ts`**:
```typescript
// Line 67-75: Correct spawning
const child = spawn(this.config.cursorAgentPath, args, {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe']
});

if (prompt) {
  child.stdin.write(prompt);
  child.stdin.end();
}
```

**`src/client/agent.ts`**:
```typescript
// Line 151-156: Correct spawning
const child = spawn(agentPath, args, {
  cwd: session.cwd || process.cwd(),
  stdio: ["ignore", "pipe", "pipe"]
});

// Line 163-189: Correct event parsing
rl.on("line", async (line) => {
  const evt = JSON.parse(line);
  for (const update of await this.tools.mapCursorEventToAcp(evt, sessionId)) {
    this.client.sessionUpdate({ sessionId, update: update as any });
  }
});
```

**Status**: Cursor integration is **correctly implemented**. The problem is bridging this to OpenCode.

---

## What Needs to Exist (HTTP Bridge)

**Missing Component**: HTTP server that translates between:

1. **OpenCode's HTTP requests** (OpenAI-compatible format)
2. **cursor-agent's stdin/stdout** (JSON stream format)

**Required Implementation**:
```typescript
// src/server.ts (NEW FILE NEEDED)
import { createServer } from "http";
import { SimpleCursorClient } from "./client/simple.js";

const server = createServer(async (req, res) => {
  // 1. Parse OpenAI-compatible request from OpenCode
  const body = await parseOpenAIRequest(req);

  // 2. Extract prompt and options
  const prompt = extractPrompt(body.messages);
  const stream = body.stream;

  // 3. Call cursor-agent via stdin/stdout
  const client = new SimpleCursorClient();
  const cursorStream = client.executePromptStream(prompt, {
    model: body.model,
    cwd: process.cwd()
  });

  // 4. Stream cursor-agent output back as OpenAI format
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

  for await (const line of cursorStream) {
    const evt = JSON.parse(line);
    const openAIChunk = convertToOpenAIFormat(evt);
    res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
  }

  res.write("data: [DONE]\n\n");
});

server.listen(32123);
console.log("HTTP server running on http://127.0.0.1:32123");
```

---

## Solution Options

### Option 1: Implement HTTP Server Bridge ✅ **RECOMMENDED**

**Approach**: Create HTTP server that translates OpenCode's OpenAI-compatible requests to cursor-agent's stdin/stdout.

**Implementation Plan**:

1. **Create `src/server.ts`** (~200 lines)
   - HTTP server listening on port 32123
   - Parse OpenAI `/v1/chat/completions` requests
   - Translate to cursor-agent command-line args
   - Spawn cursor-agent with stdin/stdout
   - Convert cursor-agent JSON events to OpenAI SSE format

2. **Modify `src/index.ts`** (~50 lines)
   - Start HTTP server on plugin load
   - Keep reference for cleanup
   - Handle server lifecycle (start/stop)

3. **Update `src/core/provider.ts`** (~30 lines)
   - Remove `languageModels` object (not used by HTTP approach)
   - Keep provider metadata only

**Files to Create/Modify**:
- ✅ Create: `src/server.ts` (200 lines)
- ✅ Modify: `src/index.ts` (50 lines)
- ✅ Modify: `src/core/provider.ts` (30 lines)
- ❌ Delete: `src/client/agent.ts` (ACP implementation - wrong for this)
- ❌ Delete: `src/client/tools.ts`, `sessions.ts`, `metrics.ts`, `retry.ts`, `cursor.ts` (unused with HTTP)

**Total New Code**: ~280 lines
**Total Code Removed**: ~1,200 lines (ACP implementation)

**Effort**: 2-3 hours

**Pros**:
- Works within OpenCode's documented architecture
- Leverages existing cursor-agent wrapper
- Simpler than ACP approach
- Remove unused complexity

**Cons**:
- Requires HTTP server (unavoidable)
- Additional process/port management

---

### Option 2: Use Plugin Hooks for Direct Execution ⚠️ **EXPERIMENTAL**

**Approach**: Try to use `@opencode-ai/plugin` hooks to bypass HTTP entirely.

**Implementation Plan**:

1. **Completely rewrite `src/index.ts`** (~150 lines)
   - Use `Plugin` type instead of `Provider`
   - Implement `chat.params` hook
   - Use `chat.message` for response handling

2. **Research required**: How to send model responses through hooks

**Major Risks**:
- ❌ **Not documented** if hooks can provide model responses
- ❌ May conflict with provider selection UI
- ❌ OpenCode might ignore these hooks
- ❌ Unknown if streaming works through hooks

**Effort**: 1-2 days (high risk of failure)

**Verdict**: NOT RECOMMENDED - experimental approach with unknown outcomes.

---

### Option 3: Use OpenCode SDK Client ❌ **WRONG DIRECTION**

**Approach**: Use `@opencode-ai/sdk` to create a server/client pair.

**Problem**: This is for **external applications** to control OpenCode programmatically, not for OpenCode to use your plugin.

**Why Wrong**:
- SDK's `createOpencode()` starts an OpenCode SERVER
- This would make YOUR plugin start OpenCode
- Circular dependency: OpenCode → Plugin → OpenCode

**Verdict**: WRONG APPROACH - SDK is for reverse integration (external app controlling OpenCode), not providers.

---

### Option 4: Publish as AI SDK Provider 🟢 **ALTERNATIVE**

**Approach**: Publish a new npm package `@ai-sdk/cursor-agent` that implements the AI SDK provider interface.

**Implementation Plan**:

1. **Create separate repo**: `ai-sdk-provider-cursor-agent`
2. **Implement `@ai-sdk/provider` interface**
3. **HTTP server translating to cursor-agent**
4. **Publish to npm**: `@ai-sdk/cursor-agent`
5. **Update `opencode.json`** to use new package

**Example usage**:
```yaml
provider:
  cursor-agent:
    npm: "@ai-sdk/cursor-agent"
    options:
      baseURL: "http://127.0.0.1:32123/v1"
```

**Pros**:
- Reusable across multiple projects
- Standard AI SDK interface
- Clean separation of concerns
- Follows established patterns (like `ai-sdk-provider-opencode-sdk`)

**Cons**:
- Requires maintaining separate npm package
- More complex release process
- User must install additional dependency

**Effort**: 4-6 hours (includes publishing)

**Verdict**: Good long-term solution, but overkill for immediate fix.

---

## Recommended Solution: Option 1 (HTTP Server Bridge)

**Why This is Best**:

1. **Works within documented constraints** ✅
   - OpenCode requires HTTP providers
   - We implement HTTP bridge

2. **Minimal implementation** ✅
   - ~280 lines new code
   - Remove ~1,200 lines of unused ACP code

3. **Low risk** ✅
   - Uses well-understood patterns
   - Leverages existing cursor-agent wrapper
   - No experimental features

4. **Quick to implement** ✅
   - 2-3 hours of work
   - Immediate functionality

---

## Detailed Implementation Plan

### Phase 1: Create HTTP Server Bridge (2 hours)

**File**: `src/server.ts` (new)

```typescript
import { createServer, IncomingMessage, ServerResponse } from "http";
import { createSimpleCursorClient } from "./client/simple.js";
import type { CursorResponse } from "./client/types.js";

interface OpenAIRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { content?: string };
    finish_reason: string | null;
  }>;
}

const cursorClient = createSimpleCursorClient();

async function parseOpenAIRequest(req: IncomingMessage): Promise<OpenAIRequest> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function convertCursorToOpenAI(cursorOutput: string): OpenAIChunk | null {
  try {
    const evt = JSON.parse(cursorOutput);
    if (evt.type === "assistant" && evt.message?.content?.[0]?.text) {
      const text = evt.message.content[0].text;
      return {
        id: evt.session_id || generateId(),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "cursor-agent",
        choices: [{
          index: 0,
          delta: { content: text },
          finish_reason: null,
        }],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function startServer(port: number = 32123): Promise<void> {
  const server = createServer(async (req, res) => {
    // Handle CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      try {
        const body = await parseOpenAIRequest(req);

        // Extract prompt from messages
        const lastMessage = body.messages[body.messages.length - 1];
        const prompt = lastMessage?.content || "";

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Stream cursor-agent output
        const cursorStream = cursorClient.executePromptStream(prompt, {
          model: body.model === "cursor-acp/auto" ? "auto" : body.model,
          cwd: process.cwd(),
        });

        for await (const line of cursorStream) {
          const chunk = convertCursorToOpenAI(line);
          if (chunk) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }

        // Send final chunk
        const finalChunk: OpenAIChunk = {
          id: generateId(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "cursor-agent",
          choices: [{
            index: 0,
            delta: { content: "" },
            finish_reason: "stop",
          }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, () => {
    console.log(`Cursor HTTP bridge server running on http://127.0.0.1:${port}`);
  });
}

export function stopServer(): void {
  // TODO: Implement graceful shutdown
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}
```

---

### Phase 2: Integrate Server into Plugin (30 minutes)

**File**: `src/index.ts` (modify)

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { startServer, stopServer } from "./server.js";

const CursorAcpPlugin: Plugin = async (input) => {
  // Start HTTP server
  const serverPort = 32123;
  await startServer(serverPort);

  console.log(`[cursor-acp] HTTP bridge server started on port ${serverPort}`);

  // No hooks needed - HTTP server handles everything
  return {
    config: async (config) => {
      // Validate config
    },
  };
};

export { CursorAcpPlugin };
export default CursorAcpPlugin;
```

---

### Phase 3: Simplify Provider (15 minutes)

**File**: `src/core/provider.ts` (simplify)

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { startServer, stopServer } from "../server.js";

export interface CursorProviderConfig {
  port?: number;
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
}

const createCursorProvider = (config: CursorProviderConfig = {}) => {
  const serverPort = config.port || 32123;

  return {
    async getHooks() {
      await startServer(serverPort);

      return {
        config: async (config) => {
          // Config validation
        },
      };
    },

    async shutdown() {
      stopServer();
    }
  };
};

export const createCursorProvider = (config: CursorProviderConfig = {}) => {
  return new CursorProvider();
};
```

---

### Phase 4: Update Installer (30 minutes)

**File**: `cmd/installer/tasks.go` (modify)

```go
// Line 204-211: Update provider config
providers["cursor-acp"] = map[string]interface{}{
    "npm":  "@opencode-ai/plugin",  // Changed from @ai-sdk/openai-compatible
    "name": "Cursor Agent (HTTP Bridge)",
    "options": map[string]interface{}{
        // No baseURL needed - plugin manages server
        // Keep empty or remove entirely
    },
    "models": models,
}
```

---

### Phase 5: Remove Unused ACP Code (10 minutes)

**Delete these files**:
- `src/client/agent.ts`
- `src/client/tools.ts`
- `src/client/sessions.ts`
- `src/client/metrics.ts`
- `src/client/retry.ts`
- `src/client/cursor.ts`

**Keep**:
- `src/client/simple.ts` (used by HTTP bridge)
- `src/client/logger.ts` (if used)
- `src/client/types.ts` (if used)

---

## Testing Plan

### Test 1: HTTP Server Starts
```bash
node dist/index.js
# Expected: "Cursor HTTP bridge server running on http://127.0.0.1:32123"
```

### Test 2: OpenAI Endpoint Responds
```bash
curl -X POST http://127.0.0.1:32123/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cursor-acp/auto",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
# Expected: SSE stream with cursor-agent response
```

### Test 3: OpenCode Integration
```bash
opencode "Hello world" --model=cursor-acp/auto
# Expected: Working cursor-agent response
```

### Test 4: Streaming Works
```bash
opencode "Write a function" --model=cursor-acp/auto
# Expected: Real-time streaming from cursor-agent
```

---

## Risks & Mitigations

### Risk 1: Port 32123 Already in Use
**Mitigation**: Make port configurable via environment variable

```typescript
const serverPort = parseInt(process.env.CURSOR_ACP_PORT || "32123");
```

---

### Risk 2: cursor-agent Not Installed
**Mitigation**: Better error messages

```typescript
try {
  spawn("cursor-agent", args);
} catch (error) {
  console.error(`
  cursor-agent not found. Install with:
    curl -fsS https://cursor.com/install | bash

  Then run: cursor-agent login
  `);
}
```

---

### Risk 3: Streaming Format Mismatch
**Mitigation**: Thorough testing of OpenAI SSE format

```typescript
// Reference: https://platform.openai.com/docs/api-reference/streaming
// Format: data: {json}\n\ndata: [DONE]\n\n
```

---

## Alternative Long-Term: Publish as AI SDK Provider

If the HTTP bridge works well, consider publishing as a standalone npm package:

### Repo Structure
```
ai-sdk-provider-cursor-agent/
├── src/
│   ├── index.ts          # Main provider export
│   ├── server.ts         # HTTP bridge
│   └── cursor-client.ts  # cursor-agent wrapper
├── package.json
└── README.md
```

### Benefits
- Reusable across projects
- Follows AI SDK patterns
- Easier for others to contribute

### Timeline
- Phase 1 (HTTP bridge): 2-3 hours (immediate fix)
- Phase 2 (Publish npm): 4-6 hours (long-term)

---

## Summary

### Current State: BROKEN 🔴
- No HTTP server exists
- OpenCode cannot connect
- Plugin is non-functional

### Root Cause: Architectural Mismatch
- OpenCode requires HTTP providers
- Code implements stdin/stdout directly
- No bridge between them

### Solution: HTTP Server Bridge (Option 1)
- ✅ Works within documented constraints
- ✅ Minimal implementation (~280 lines)
- ✅ Low risk
- ✅ Quick (2-3 hours)
- ⚠️ Requires HTTP server (unavoidable)

### Next Steps
1. Implement HTTP server bridge (`src/server.ts`)
2. Integrate server into plugin (`src/index.ts`)
3. Simplify provider (`src/core/provider.ts`)
4. Update installer config
5. Remove unused ACP code
6. Test thoroughly
7. Consider publishing as standalone npm package

---

**Effort Estimate**: 2-3 hours for immediate fix
**Alternative Long-Term**: 4-6 hours to publish as AI SDK provider
