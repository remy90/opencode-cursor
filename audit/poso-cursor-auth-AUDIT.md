# Audit Report: poso-cursor-auth (OpenCode Cursor Auth Plugin)

**Audit Date**: 2026-01-29
**Auditor**: Claude Code
**Project**: https://github.com/POSO-PocketSolutions/opencode-cursor-auth
**Version Analyzed**: 1.0.16
**Total Lines of Code**: ~906 (568 in plugin.ts alone)

---

## Executive Summary

- **Clever HTTP Proxy Architecture**: Uses a local HTTP server (port 32123) that translates OpenAI-compatible API calls to `cursor-agent` CLI invocations, enabling seamless integration with existing OpenCode infrastructure without modifying core code.

- **Dual Authentication Strategy**: Implements a fallback chain - first tries to extract tokens from Cursor IDE's SQLite database, then falls back to cursor-agent's auth file, maximizing compatibility with different Cursor installation methods.

- **Bun-First Runtime Design**: Explicitly built for Bun runtime with `bun:sqlite` for database access and `Bun.spawn`/`Bun.serve` for process management, requiring Bun but leveraging its performance advantages.

- **Experimental Tool Calling**: Implements custom tool-calling via prompt engineering (injecting tool schemas into prompts and parsing JSON responses), rather than native Cursor tool support - clever but fragile approach.

- **Tight Coupling to cursor-agent**: Entirely dependent on the `cursor-agent` binary being installed and authenticated - does not implement independent API authentication.

---

## Architecture Analysis

### 1. Plugin Structure

**File Organization**:
```
src/
├── index.ts          # Minimal entry point (1 line)
├── plugin.ts         # Main plugin implementation (568 lines - 63% of codebase)
├── cli.ts            # Standalone CLI auth test (20 lines)
├── constants.ts      # Provider ID and API base URL (2 lines)
├── bun-sqlite.d.ts   # Type declarations for bun:sqlite (9 lines)
├── cursor/
│   ├── types.ts      # Auth type definitions (18 lines)
│   ├── auth.ts       # Auth orchestrator with fallback (24 lines)
│   ├── local.ts      # SQLite DB token extraction (47 lines)
│   └── agent.ts      # cursor-agent auth file reader (75 lines)
└── utils/
    ├── db.ts         # Dual SQLite backend (Bun/Node) (44 lines)
    ├── jwt.ts        # JWT decoding utilities (25 lines)
    └── platform.ts   # Cross-platform path resolution (34 lines)
```

**Key Observations**:
- Highly centralized architecture - `plugin.ts` contains 63% of all logic
- Clean separation between auth strategies (local vs agent)
- Utility modules are small, focused, and reusable
- Type definitions are minimal but sufficient

### 2. HTTP Proxy Pattern

**Innovation**: Instead of implementing a custom provider that calls `cursor-agent` directly, they run a local HTTP server that:

1. Exposes OpenAI-compatible endpoints (`/v1/chat/completions`, `/health`)
2. Translates HTTP requests to `cursor-agent` CLI invocations
3. Returns OpenAI-compatible responses

**Why This Works**:
- OpenCode already has OpenAI-compatible provider support via `@ai-sdk/openai-compatible`
- No need to write custom provider integration - just point baseURL to localhost
- Automatic retry, error handling, and streaming support through existing infrastructure

**Implementation Details**:
```typescript
// From plugin.ts lines 207-519
async function ensureCursorProxyServer(workspaceDirectory: string): Promise<string> {
  // Singleton pattern using globalThis to avoid duplicate servers
  // Auto-detects if server already running on port 32123
  // Falls back to random port if default is taken
  // Supports both streaming and non-streaming responses
}
```

**Port Management Strategy**:
- Default port: 32123
- Health check endpoint: `/health`
- If port in use: checks if it's their proxy (via health check), reuses if yes
- If port in use by other service: falls back to random port
- Global singleton prevents duplicate servers in same process

### 3. Authentication Flow

**Dual Strategy with Fallback** (lines 5-24 in `cursor/auth.ts`):

```typescript
export async function getCursorAuth(): Promise<CursorAuthResult> {
  // 1. Try Local DB (IDE) - extracts from Cursor's SQLite state DB
  const localResult = await loginLocal();
  if (localResult.type === "success") return localResult;

  // 2. Try Agent Config - reads cursor-agent's auth.json
  const agentResult = await loginAgent();
  if (agentResult.type === "success") return agentResult;

  return { type: "failed", error: "..." };
}
```

**Local DB Extraction** (`cursor/local.ts`):
- Reads from Cursor's `state.vscdb` SQLite database
- Platform-aware paths (macOS, Windows, Linux)
- Extracts: `cursorAuth/accessToken`, `cursorAuth/refreshToken`, `cursorAuth/cachedEmail`
- JWT decoding to extract email and expiry if not in DB

**Agent Auth Extraction** (`cursor/agent.ts`):
- Reads from `~/.cursor/auth.json` (macOS) or platform equivalent
- Simpler JSON file read, no database needed
- Same JWT decoding for metadata extraction

### 4. Database Access Strategy

**Dual Runtime Support** (`utils/db.ts`):

```typescript
export async function getDbValue(dbPath: string, key: string): Promise<string | null> {
  // Bun runtime: uses bun:sqlite (native, no native addons)
  if (isBunRuntime()) {
    const mod = await import("bun:sqlite");
    // ...
  }

  // Node runtime: uses better-sqlite3 (native .node addon)
  const mod = await import("better-sqlite3");
  // ...
}
```

**Rationale**: Bun cannot load native Node.js addons (.node files), so they use Bun's built-in SQLite when running under Bun, and better-sqlite3 for Node.js compatibility.

---

## Feature Comparison

### Models Supported

| Model | poso-cursor-auth | opencode-cursor (ours) |
|-------|------------------|------------------------|
| auto | ✅ | ✅ |
| gpt-5.2 | ✅ | ✅ |
| gpt-5.1 | ✅ | ❌ |
| gpt-5.1-codex | ✅ | ❌ |
| sonnet-4.5 | ✅ | ✅ |
| sonnet-4.5-thinking | ✅ | ✅ |
| opus-4.5 | ❌ | ✅ |
| opus-4.5-thinking | ❌ | ✅ |
| gemini-3-pro | ❌ | ✅ |
| gemini-3-flash | ❌ | ✅ |
| grok | ❌ | ✅ |
| composer-1 | ❌ | ✅ |

**Model Aliases** (plugin.ts lines 40-49):
```typescript
const aliases: Record<string, string> = {
  "gpt-5": "gpt-5.2",     // Maps gpt-5 → gpt-5.2
  "sonnet-4": "sonnet-4.5", // Maps sonnet-4 → sonnet-4.5
};
```

### Communication Methods

| Feature | poso-cursor-auth | opencode-cursor (ours) |
|---------|------------------|------------------------|
| **Communication** | CLI arguments (prompt as arg) | Stdin streaming |
| **E2BIG Protection** | ❌ No - large prompts may hit arg limits | ✅ Yes - stdin avoids arg limits |
| **Streaming** | ✅ Yes | ✅ Yes |
| **Tool Calling** | ✅ Experimental (prompt-based) | ✅ Via AI SDK |
| **Error Handling** | Basic | Comprehensive with retry |
| **Session Management** | ❌ None | ✅ ACP-compliant |
| **Metrics** | ❌ None | ✅ Built-in |

### Tool Calling Implementation

**poso-cursor-auth Approach** (plugin.ts lines 146-169):

```typescript
function buildToolCallingPrompt(conversation: string, tools: ToolDef[], workspaceDirectory: string): string {
  return [
    "You are a tool-calling assistant running inside OpenCode.",
    `Workspace directory: ${workspaceDirectory}`,
    "",
    "Available tools:",
    toolList,
    "",
    "STRICT OUTPUT:",
    "- Output MUST be exactly one JSON object and nothing else.",
    "",
    "RESPONSE FORMAT:",
    '- Call tool(s): {"action":"tool_call","tool_calls":[...]}',
    '- Final answer: {"action":"final","content":"..."}',
    "",
    "Task:",
    conversation,
  ].join("\n");
}
```

**How It Works**:
1. Injects tool schemas directly into the prompt
2. Expects cursor-agent to output valid JSON
3. Parses JSON to extract tool calls or final content
4. Maps to OpenAI-compatible tool_calls format

**Auto Model Selection for Tools** (line 239-241):
```typescript
if (tools.length && selectedModel === "auto") {
  selectedModel = "sonnet-4.5-thinking"; // Forces thinking model for tool calls
}
```

---

## Code Quality Assessment

### Strengths

1. **TypeScript Strict Mode**: Enabled in tsconfig.json with all strict options
2. **Platform Abstraction**: Clean `utils/platform.ts` handles macOS/Windows/Linux paths
3. **Error Handling**: Consistent try-catch blocks with meaningful error messages
4. **JWT Utilities**: Proper base64 decoding with fallbacks (utils/jwt.ts)
5. **Runtime Detection**: Smart Bun vs Node detection for database access

### Areas of Concern

1. **Centralized Complexity**: 568 lines in plugin.ts is too much for one file
2. **Any Type Usage**: Heavy use of `any` type for OpenAI compatibility:
   ```typescript
   type ToolDef = {
     type?: string;
     function?: {
       name?: string;
       description?: string;
       parameters?: any;  // <-- any
     };
   };
   ```
3. **Global State**: Uses `globalThis` for singleton server management (line 207-214)
4. **Streaming Buffering**: For tool calls with streaming, buffers entire response before sending (lines 345-417)
5. **No Validation**: No Zod schemas for response validation despite having Zod as dependency

### Dependencies Analysis

**Production Dependencies**:
- `better-sqlite3`: ^11.8.1 - Native SQLite for Node fallback
- `zod`: ^3.24.1 - Imported but not effectively used

**Dev Dependencies**:
- `@opencode-ai/plugin`: ^1.0.168 - Plugin SDK
- `@opencode-ai/sdk`: ^1.0.168 - Core SDK

**Dependency Issues**:
- Zod is listed but not used for any validation (only has schema imports in dev deps)
- better-sqlite3 may fail to install on some systems (requires native compilation)

---

## OpenCode Integration Analysis

### Plugin Registration

**Entry Point** (plugin.ts lines 521-568):

```typescript
export const CursorAuthPlugin: Plugin = async ({ $, directory }: PluginInput) => {
  const proxyBaseURL = await ensureCursorProxyServer(directory);

  return {
    auth: {
      provider: CURSOR_PROVIDER_ID, // "cursor"
      async loader(_getAuth: () => Promise<Auth>) {
        return {}; // No actual auth tokens stored
      },
      methods: [
        {
          label: "Login via cursor-agent (opens browser)",
          type: "api",
          authorize: async () => {
            // Runs cursor-agent login if needed
          },
        },
      ],
    },

    async "chat.params"(input, output) {
      // Injects proxy baseURL into chat requests
      output.options.baseURL = proxyBaseURL;
      output.options.apiKey = output.options.apiKey || "cursor-agent";
    },
  };
};
```

**Integration Pattern**:
1. Plugin starts HTTP proxy server locally
2. Auth method checks if cursor-agent is installed/authenticated
3. `chat.params` hook injects `baseURL` pointing to local proxy
4. OpenCode's existing OpenAI-compatible provider sends requests to proxy
5. Proxy translates to cursor-agent CLI calls and returns responses

### Configuration Requirements

**User Configuration** (from README):

```json
{
  "plugin": ["opencode-cursor-auth@1.0.16"],
  "provider": {
    "cursor": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cursor Agent (local)",
      "options": {
        "baseURL": "http://127.0.0.1:32123/v1"
      },
      "models": {
        "auto": { "name": "Cursor Agent Auto" },
        "gpt-5": { "name": "Cursor Agent GPT-5" },
        ...
      }
    }
  }
}
```

**Key Point**: Requires manual configuration of both plugin AND provider - not a turnkey solution.

---

## Unique Strengths

### 1. HTTP Proxy Architecture

**What They Did Exceptionally Well**:
- Instead of fighting the provider system, they leveraged it
- By exposing an OpenAI-compatible HTTP interface, they get:
  - Free retry logic
  - Free error handling
  - Free streaming support
  - Free tool-call formatting
  - No need to implement custom provider

**Innovation Score**: 9/10 - This is genuinely clever engineering

### 2. Dual Authentication Strategy

**Smart Fallback Chain**:
1. Try Cursor IDE's database (for users who use Cursor app)
2. Try cursor-agent auth file (for CLI-only users)
3. Either way, works for both user types

**User Experience**: Users don't need to know which auth method they have

### 3. Platform Awareness

**Robust Cross-Platform Support**:
```typescript
// utils/platform.ts handles:
- macOS: ~/Library/Application Support/Cursor/...
- Windows: %APPDATA%/Cursor/...
- Linux: ~/.config/Cursor/... or $XDG_CONFIG_HOME
```

**Considers**: XDG_CONFIG_HOME, APPDATA, homedir variations

### 4. Runtime Adaptability

**Smart Database Backend**:
- Detects Bun vs Node at runtime
- Uses appropriate SQLite implementation
- Graceful degradation with warnings

### 5. Tool Calling Without Native Support

**Creative Prompt Engineering**:
- Injects tool schemas into prompts
- Forces JSON output format
- Parses responses to extract tool calls
- Works even though cursor-agent may not natively support tools

**Limitation**: Fragile - depends on model following instructions exactly

---

## Weaknesses and Gaps

### 1. Bun-Only Runtime Requirement

**Critical Limitation**:
```typescript
if (!bunAny.Bun?.spawn) {
  return openAIError(500, "This provider requires Bun runtime.");
}
```

- Cannot run under Node.js (despite having better-sqlite3 for DB access)
- Requires users to have Bun installed
- Limits adoption to Bun users only

### 2. E2BIG Error Vulnerability

**Design Flaw**:
```typescript
const cmd = [
  "cursor-agent",
  "--print",
  "--output-format", "text",
  "--workspace", workspaceDirectory,
  "--model", selectedModel,
  effectivePrompt,  // <-- Passed as CLI argument!
];
```

- Large prompts are passed as command-line arguments
- Unix systems have ARG_MAX limits (typically 128KB-2MB)
- Large codebases will hit "Argument list too long" errors
- No stdin-based alternative

**Severity**: High - This will break on real-world usage with large contexts

### 3. No Session Management

**Missing Feature**:
- No conversation state tracking
- Each request is completely independent
- No way to maintain context across multiple turns
- Tool call results are injected into single prompt

**Impact**: Poor multi-turn conversation support

### 4. No Metrics or Observability

**Missing**:
- No token usage tracking
- No latency metrics
- No error rate tracking
- No logging infrastructure
- Console.warn only for DB errors

**Impact**: Cannot monitor or optimize usage

### 5. Fragile Tool Calling

**Issues**:
1. Relies on prompt engineering - model may not follow format
2. No validation of tool call schemas
3. No error recovery if JSON parsing fails
4. Forces "thinking" model for all tool calls (may be overkill)

**Example of fragility** (lines 121-144):
```typescript
function parseToolCallPlan(output: string): ToolCallPlan | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  // Just finds first { and last } - could match wrong JSON!
}
```

### 6. Hardcoded Dependencies

- `cursor-agent` must be in PATH
- Port 32123 hardcoded (though fallback exists)
- No configuration for proxy host/port
- No configuration for cursor-agent path

### 7. Missing Model Support

**Not Supported**:
- Opus models (Claude 4.5 Opus)
- Gemini models
- Grok
- Composer mode

**Why**: Only maps models that cursor-agent explicitly supports

### 8. No Retry Logic

**Single Attempt**:
- If cursor-agent fails, request fails
- No exponential backoff
- No handling of temporary failures
- No fallback models

### 9. Test Coverage

**From package.json**:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```

- No unit tests
- No integration tests
- No CI/CD configuration visible

---

## Recommendations for Our Project

### Adopt

1. **HTTP Proxy Pattern**: Consider adding an HTTP proxy mode as an option
   - Could provide better compatibility with existing tools
   - Allows external processes to use our cursor integration
   - Code location: New `src/proxy.ts` module

2. **Dual Auth Strategy**: Implement similar fallback chain
   - Add SQLite DB reading as primary method
   - Keep env vars as fallback
   - Improves user experience for Cursor IDE users

3. **Platform Path Abstraction**: Enhance our path utilities
   - Add XDG_CONFIG_HOME support
   - Add Windows APPDATA support
   - Make auth file discovery more robust

4. **Model Aliases**: Add user-friendly model aliases
   - `gpt-5` → `gpt-5.2`
   - `sonnet` → `sonnet-4.5`
   - Improves UX

### Improve Upon

1. **E2BIG Fix**: Our stdin-based approach is superior
   - Keep our `executePromptStream` stdin communication
   - Their CLI-arg approach will fail on large prompts
   - This is a major competitive advantage

2. **Runtime Flexibility**: Support both Bun AND Node
   - We currently require Bun too - consider adding Node support
   - Use their runtime detection pattern for DB access

3. **Tool Calling**: Leverage AI SDK instead of prompt engineering
   - Our AI SDK integration is more robust
   - Their prompt-based approach is fragile
   - Keep our current tool implementation

### Avoid

1. **Bun-Only HTTP Server**: Their `Bun.serve` requirement limits adoption
   - If we add proxy mode, use Node-compatible server (Express/Fastify)

2. **Single-File Complexity**: 568 lines in one file is unmaintainable
   - Keep our modular architecture
   - Our separation into client/, acp/, utils/ is better

3. **Global State Management**: `globalThis` singleton is hacky
   - Use proper dependency injection
   - Our class-based approach is cleaner

4. **Missing Test Coverage**: They have no tests
   - Keep our comprehensive test suite
   - Add more tests, not fewer

### Competitive Advantages to Highlight

| Feature | poso-cursor-auth | opencode-cursor | Winner |
|---------|------------------|-----------------|--------|
| E2BIG Protection | ❌ | ✅ | **Us** |
| Session Management | ❌ | ✅ | **Us** |
| Metrics | ❌ | ✅ | **Us** |
| Retry Logic | ❌ | ✅ | **Us** |
| Test Coverage | ❌ | ✅ | **Us** |
| Model Variety | 6 | 11 | **Us** |
| Runtime | Bun only | Bun (Node potential) | Tie |
| Auth Methods | 2 | 1 (env only) | **Them** |
| Proxy Mode | ✅ | ❌ | **Them** |
| Setup Complexity | High (config needed) | Low | **Us** |

---

## Code Snippets for Reference

### Proxy Server Initialization

```typescript
// From plugin.ts lines 467-486
const bunAny = globalThis as any;
if (typeof bunAny.Bun !== "undefined" && typeof bunAny.Bun.serve === "function") {
  // Check if existing proxy running
  try {
    const res = await fetch(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`).catch(() => null);
    if (res && res.ok) {
      g[key].baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
      return CURSOR_PROXY_DEFAULT_BASE_URL;
    }
  } catch {
    // ignore
  }

  const startServer = (port: number) => {
    return bunAny.Bun.serve({
      hostname: CURSOR_PROXY_HOST,
      port,
      fetch: handler,  // Handler defined earlier
    });
  };
  // ...
}
```

### Tool Call Response Building

```typescript
// From plugin.ts lines 279-312
const plan = tools.length ? parseToolCallPlan(stdout) : null;
if (plan?.action === "tool_call") {
  const toolCalls = plan.tool_calls.map((tc, i) => ({
    id: `call_${Date.now()}_${i}`,
    type: "function",
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
    },
  }));

  const payload = {
    id: `cursor-agent-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: selectedModel,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      },
      finish_reason: "tool_calls",
    }],
  };
  // ...
}
```

### Auth Fallback Chain

```typescript
// From cursor/auth.ts lines 5-24
export async function getCursorAuth(): Promise<CursorAuthResult> {
  // 1. Try Local DB (IDE)
  const localResult = await loginLocal();
  if (localResult.type === "success") {
    return localResult;
  }

  // 2. Try Agent Config
  const agentResult = await loginAgent();
  if (agentResult.type === "success") {
    return agentResult;
  }

  return {
    type: "failed",
    error: `No authentication found.
    Checked Local DB: ${localResult.error}
    Checked Agent Config: ${agentResult.error}`
  };
}
```

---

## Conclusion

**poso-cursor-auth** is a clever implementation that takes a novel approach to Cursor integration through an HTTP proxy pattern. Their dual authentication strategy and platform awareness demonstrate solid engineering. However, the project has significant limitations:

1. **Bun-only runtime** limits adoption
2. **E2BIG vulnerability** makes it unsuitable for large prompts
3. **No session management** limits conversation depth
4. **No observability** makes it hard to monitor
5. **No tests** raises quality concerns

**Our project (opencode-cursor)** has superior architecture for production use:
- Stdin-based communication avoids E2BIG errors
- Comprehensive session management
- Built-in metrics and observability
- Full test coverage
- More model support

**Recommendation**: Consider adopting their HTTP proxy pattern as an optional mode for compatibility, and implement their dual auth strategy to improve user experience. Maintain our current architecture as the primary implementation.

---

**End of Audit Report**
