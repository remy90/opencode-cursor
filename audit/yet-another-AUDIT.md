# Competitive Audit Report: yet-another-opencode-cursor-auth

**Audit Date**: 2026-01-29
**Auditor**: Claude Code Audit Agent
**Project Analyzed**: `yet-another-opencode-cursor-auth` (v0.1.1)
**Repository**: https://github.com/Yukaii/yet-another-opencode-cursor-auth

---

## Executive Summary

- **Sophisticated Plugin Architecture**: Implements a clean separation between the OpenCode plugin interface and the Cursor API integration, using a custom `fetch` handler instead of a proxy server - eliminating network overhead and simplifying deployment.

- **Advanced Protocol Implementation**: Reverse-engineered Cursor's Agent API with full protobuf support, bidirectional streaming via SSE (Server-Sent Events), and complex session management with heartbeat monitoring and auto-recovery.

- **Comprehensive Tool Calling**: Maps Cursor's native exec tools (shell, read, write, ls, grep) to OpenAI-compatible function calls with full MCP (Model Context Protocol) passthrough support for external tools.

- **Production-Grade Features**: Includes automatic token refresh with JWT expiration detection, model discovery from Cursor's API, intelligent token counting per model provider (OpenAI, Anthropic, Gemini), and detailed performance timing metrics.

- **Session Architecture Limitations**: True session reuse is fundamentally blocked by the mismatch between OpenAI's request/response model and Cursor's stateful bidirectional streaming. The workaround (fresh requests with full history) adds ~3-6s latency per tool continuation.

---

## Architecture Analysis

### 1. Directory Structure & Organization

```
yet-another-opencode-cursor-auth/
├── src/
│   ├── index.ts                    # Main exports (plugin factory)
│   ├── server.ts                   # Standalone proxy server (development)
│   ├── lib/
│   │   ├── api/
│   │   │   ├── agent-service.ts    # Cursor Agent API client (1200+ lines)
│   │   │   ├── cursor-client.ts    # Legacy Cursor API (deprecated)
│   │   │   ├── cursor-models.ts    # Model discovery & mapping
│   │   │   └── proto/              # Protocol buffer implementation
│   │   │       ├── agent-messages.ts   # Agent message encoding/decoding
│   │   │       ├── bidi.ts            # Bidirectional streaming helpers
│   │   │       ├── encoding.ts        # Protobuf encoding primitives
│   │   │       ├── decoding.ts        # Protobuf decoding primitives
│   │   │       ├── exec.ts            # Exec request/response types
│   │   │       ├── interaction.ts     # Interaction update parsing
│   │   │       ├── kv.ts              # KV blob storage handling
│   │   │       ├── tool-calls.ts      # Tool call message construction
│   │   │       └── types.ts           # Shared type definitions
│   │   ├── auth/
│   │   │   ├── helpers.ts          # High-level auth functions
│   │   │   ├── login.ts            # OAuth PKCE flow implementation
│   │   │   └── index.ts            # Auth exports
│   │   ├── openai-compat/
│   │   │   ├── handler.ts          # OpenAI API request handler (900+ lines)
│   │   │   ├── types.ts            # OpenAI API type definitions
│   │   │   ├── utils.ts            # Utility functions (SSE, errors)
│   │   │   └── index.ts            # Module exports
│   │   ├── utils/
│   │   │   ├── jwt.ts              # JWT parsing & validation
│   │   │   └── tokenizer.ts        # Token counting per provider
│   │   ├── session-reuse.ts        # Session management utilities
│   │   └── storage.ts              # File-based credential storage
│   └── plugin/
│       ├── plugin.ts               # OpenCode plugin implementation
│       ├── types.ts                # Plugin type definitions
│       └── index.ts                # Plugin exports
├── tests/
│   ├── unit/                       # Unit tests (openai-compat, session-reuse, tokenizer, limits)
│   └── integration/                # Integration tests (agent-service, models, tool-calling)
├── docs/                           # Comprehensive documentation
│   ├── ARCHITECTURE_COMPARISON.md  # Stateless vs Stateful analysis
│   ├── AUTH.md                     # Authentication documentation
│   ├── CURSOR_API.md               # Cursor API notes (high-level)
│   ├── FUTURE_WORK.md              # Roadmap and known limitations
│   └── OPENCODE_PLUGIN.md          # Plugin interface documentation
└── scripts/                        # Utility scripts
    ├── api-test.ts
    ├── auth-demo.ts
    ├── fetch-models.ts
    ├── investigate-kv-blobs.ts
    └── session-reuse-harness.ts
```

**Lines of Code**: ~7,400 total TypeScript lines

### 2. Key Architectural Patterns

#### A. Plugin-First Design with Serverless Fetch

Unlike typical proxy-based implementations, this project uses a **custom fetch handler** pattern:

```typescript
// From src/plugin/plugin.ts (lines 327-343)
const customFetch = createPluginFetch({
  accessToken,
  log: () => {}, // Disable logging to avoid polluting the UI
});

return {
  apiKey: "cursor-via-opencode", // Dummy key, not used
  baseURL: "https://cursor.opencode.local/v1", // Virtual URL, intercepted by fetch
  fetch: customFetch, // Intercepts all OpenAI API requests
};
```

**Advantages**:
- No separate proxy server process required
- Direct integration with OpenCode's request pipeline
- Simplified deployment (just the plugin)
- Lower latency (no HTTP hop through proxy)

#### B. Dual-Mode Operation

The codebase supports both:
1. **Plugin Mode**: Custom fetch handler for OpenCode integration
2. **Server Mode**: Standalone Bun.serve() proxy for development/testing

Both modes share the same `createRequestHandler()` core from `src/lib/openai-compat/handler.ts`.

#### C. Protocol Abstraction Layers

```
OpenCode Request
      |
      v
[OpenAI Compat Layer]  <--->  OpenAI format conversion
      |
      v
[Agent Service Client] <--->  Protobuf encoding/decoding
      |
      v
[Cursor Agent API]     <--->  gRPC-Web over SSE
```

### 3. Session Architecture Deep Dive

#### The Core Problem

From `docs/FUTURE_WORK.md` (lines 46-63):

> **Conclusion**: True session reuse across OpenAI API requests is **not possible** due to a fundamental architectural mismatch:
>
> - OpenAI API must close HTTP response to return `tool_calls` to the client
> - Client sends new HTTP request with tool results
> - This breaks the continuous streaming context that Cursor's `bidiAppend` relies on
> - BidiAppend sends tool results successfully, server acknowledges, but doesn't continue generating

#### The Workaround

```typescript
// From src/lib/openai-compat/handler.ts (lines 478-506)
// ARCHITECTURAL NOTE: We always start fresh requests when tool results arrive.
const existingSessionId = findSessionIdInMessages(messages);
const toolMessages = collectToolMessages(messages);

if (toolMessages.length > 0 && session) {
  log(`[Session Reuse] Tool messages present - closing old session and starting fresh`);
  try {
    await session.iterator.return?.();
  } catch (err) {
    log("[Session Reuse] Failed to close prior session iterator:", err);
  }
  sessionMap.delete(sessionId);
  session = undefined;
  sessionId = createSessionId();
}
```

**Impact**: ~3-6 second latency penalty for each tool call continuation due to fresh session bootstrap.

---

## Feature Comparison

### 1. Authentication Features

| Feature | Implementation | Quality |
|---------|---------------|---------|
| OAuth PKCE | Full PKCE flow with verifier/challenge | Excellent |
| Token Refresh | Automatic with 5-minute buffer | Excellent |
| JWT Parsing | Payload decoding for expiration | Good |
| API Key Auth | Manual entry support | Basic |
| Credential Storage | File-based with cross-platform paths | Good |
| Token Persistence | Refresh token + API key combo stored | Good |

### 2. Model Support

| Capability | Implementation |
|------------|---------------|
| Model Discovery | Dynamic fetch from Cursor API |
| Model Aliases | Hardcoded mapping (sonnet-4.5 -> claude-sonnet-4-5-20250929) |
| Model Limits | Context/output limits from llm-info package |
| Model Capabilities | Temperature, reasoning, attachment, toolcall flags |
| Cost Tracking | Set to 0 (Cursor handles billing) |

**Supported Models** (from `src/plugin/plugin.ts` lines 39-55):
- Claude: sonnet-4.5, sonnet-4.5-thinking, opus-4.5, opus-4.5-thinking, opus-4.1
- Gemini: gemini-3-pro, gemini-3-flash
- GPT: gpt-5.2, gpt-5.2-high, gpt-5.1, gpt-5.1-high, gpt-5.1-codex variants
- Grok: grok-4

### 3. Tool Calling Implementation

#### Cursor Native Tools Mapped to OpenAI Functions

| Cursor Tool | OpenAI Function | Parameters |
|-------------|-----------------|------------|
| `shell` | `bash` | command, cwd |
| `read` | `read` | filePath |
| `ls` | `list` | path |
| `grep` | `grep` | pattern, path |
| `grep` (glob) | `glob` | pattern, path |
| `write` | `write` | filePath, content |
| `mcp` | (passthrough) | Original tool name |

#### Tool Call Flow

```typescript
// From src/lib/openai-compat/handler.ts (lines 334-407)
if (chunk.type === "exec_request" && chunk.execRequest) {
  const execReq = chunk.execRequest;
  const { toolName, toolArgs } = mapExecRequestToTool(execReq);
  const toolAvailable = toolName ? providedToolNames.has(toolName) : false;

  // Emit exec requests as OpenAI tool calls when tools are provided
  if (toolsProvided && toolName && toolArgs && toolAvailable) {
    const currentIndex = mcpToolCallIndex++;
    const openaiToolCallId = generateToolCallId(completionId, currentIndex);

    // Emit the tool call
    const toolCallChunk: OpenAIStreamChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: currentIndex,
            id: openaiToolCallId,
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(toolArgs) },
          }],
        },
        finish_reason: null,
      }],
    };
    controller.enqueue(encoder.encode(createSSEChunk(toolCallChunk)));

    // Emit finish with tool_calls reason
    controller.enqueue(encoder.encode(createSSEChunk(
      createStreamChunk(completionId, model, created, {}, "tool_calls")
    )));

    controller.enqueue(encoder.encode(createSSEDone()));
    isClosed = true;
    controller.close();
    return;
  }
}
```

### 4. Streaming & Real-Time Features

| Feature | Status | Implementation |
|---------|--------|---------------|
| SSE Streaming | Full | Server-Sent Events with proper format |
| Heartbeat Detection | Yes | 2-minute idle timeout, 1000 beat budget |
| Stream Cancellation | Yes | AbortController with cleanup |
| Token Streaming | Yes | Real-time token deltas |
| Tool Call Streaming | Yes | Streaming tool call chunks |
| Non-Streaming | Yes | Full response collection |

### 5. Error Handling & Resilience

| Feature | Status | Notes |
|---------|--------|-------|
| Retry Logic | Partial | Exponential backoff in login (1.2x, max 10s) |
| Base URL Fallback | Yes | Tries api2, then agent backends |
| Token Refresh | Yes | Automatic with 60-second buffer |
| gRPC Error Decoding | Yes | Parses grpc-status-details-bin |
| Connection Timeout | Yes | 120-second timeout on SSE |
| Error Propagation | Good | OpenAI-format error responses |

---

## Code Quality Assessment

### 1. TypeScript Patterns

**Strengths**:
- Strong typing throughout with comprehensive interfaces
- Proper use of `unknown` with type narrowing for error handling
- Async generators for streaming (`AsyncGenerator<AgentStreamChunkType>`)
- BigInt handling for protobuf sequence numbers
- Type guards (`isOAuthAuth`, `accessTokenExpired`)

**Example of Good Type Safety**:
```typescript
// From src/lib/auth/helpers.ts (lines 62-88)
export async function getValidAccessToken(
  credentialManager: CredentialManager,
  endpoint: string = CURSOR_API_BASE_URL
): Promise<string | null> {
  const accessToken = await credentialManager.getAccessToken();

  if (accessToken && !isTokenExpiringSoon(accessToken)) {
    return accessToken;
  }

  const refreshToken = await credentialManager.getRefreshToken();
  if (refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken, endpoint);
    if (refreshed) {
      await credentialManager.setAuthentication(
        refreshed.accessToken,
        refreshed.refreshToken
      );
      return refreshed.accessToken;
    }
  }

  return accessToken ?? null;
}
```

### 2. Error Handling

**Strengths**:
- Consistent error wrapping with context
- Graceful degradation (falls back to defaults)
- Debug logging controlled by environment variables
- Proper cleanup in finally blocks

**Weaknesses**:
- Some `any` type assertions in tests
- Silent failures in some model discovery paths
- Limited error message localization

### 3. Validation & Safety

**Strengths**:
- JWT expiration validation without signature verification (appropriate for client-side)
- Input sanitization for tool call IDs
- Blob size limits in KV handling
- Checksum generation for Cursor API authentication

**Areas for Improvement**:
- No JSON Schema validation for tool arguments
- Limited request body validation
- No rate limiting implementation

### 4. Testing

**Test Coverage**:
- Unit tests: `openai-compat.test.ts`, `session-reuse.test.ts`, `tokenizer.test.ts`, `model-limits.test.ts`
- Integration tests: `agent-service.test.ts`, `models.test.ts`, `tool-calling.test.ts`
- Test framework: Bun's built-in test runner

**Test Quality**: Good mocking patterns for session management and tool calls.

### 5. Documentation

**Documentation Quality**: Excellent
- Comprehensive README with setup instructions
- Architecture comparison document
- Authentication flow documentation
- Plugin interface documentation
- Future work and roadmap
- Inline code comments for complex protobuf handling

---

## OpenCode Integration Analysis

### 1. Plugin Registration

From `opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cursor": {
      "name": "Cursor"
    }
  }
}
```

The plugin is registered under the "cursor" provider ID.

### 2. Auth Flow Integration

```typescript
// From src/plugin/plugin.ts (lines 346-421)
methods: [
  {
    label: "OAuth with Cursor",
    type: "oauth",
    authorize: async (_inputs?: Record<string, string>) => {
      console.log("\n=== Cursor OAuth Setup ===");
      // ... instructions

      const loginManager = new LoginManager();
      const { metadata, loginUrl } = loginManager.startLogin();

      return {
        url: loginUrl,
        instructions: "Complete the sign-in flow in your browser...",
        method: "auto",  // Automatic polling, no manual code entry
        callback: async (): Promise<TokenExchangeResult> => {
          // Open browser, wait for result, return tokens
        },
      };
    },
  },
  {
    label: "Manually enter API Key",
    type: "api",
  },
]
```

### 3. Custom Fetch Handler

The key innovation is the `createPluginFetch` function that intercepts all OpenAI API requests:

```typescript
// From src/lib/openai-compat/handler.ts (lines 904-916)
export function createPluginFetch(options: RequestHandlerOptions): (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response> {
  const handler = createRequestHandler(options);

  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const request = new Request(url, init);
    return handler(request);
  };
}
```

This allows the plugin to:
1. Intercept OpenAI-formatted requests from OpenCode
2. Transform them to Cursor's Agent API format
3. Stream responses back in OpenAI-compatible SSE format

---

## Strengths (What They Do Exceptionally Well)

### 1. Protocol Reverse Engineering

The project demonstrates deep understanding of Cursor's internal protocols:
- Complete protobuf message construction without official schemas
- gRPC-Web envelope handling (5-byte header format)
- Bidirectional streaming over SSE with proper framing
- KV blob storage integration for large responses
- gRPC trailer parsing for error details

### 2. Session Management Sophistication

Despite the architectural limitation, the session handling is comprehensive:
- Session ID tracking through tool call IDs
- Pending exec request mapping
- Cleanup of expired sessions
- Proper iterator cleanup on cancellation

### 3. Performance Monitoring

Built-in timing metrics (from `src/lib/api/agent-service.ts` lines 98-130):
```
[TIMING] ═══════════════════════════════════════════════════════
[TIMING] Request Performance Summary
[TIMING] ───────────────────────────────────────────────────────
[TIMING]   Message build:     Xms
[TIMING]   SSE connection:    Xms
[TIMING]   First BidiAppend:  Xms
[TIMING]   First chunk:       Xms
[TIMING]   First text:        Xms
[TIMING]   First tool call:   Xms
[TIMING]   Turn ended:        Xms
[TIMING]   Total:             Xms
```

### 4. Multi-Provider Token Counting

Intelligent tokenizer selection based on model name patterns:
- OpenAI models: gpt-tokenizer
- Anthropic models: @anthropic-ai/tokenizer
- Gemini models: gpt-tokenizer fallback

### 5. Tool Call Completeness

Full tool lifecycle support:
- Tool discovery and registration
- Streaming tool call emission
- Tool result formatting per tool type
- Resume action signaling for continuation

---

## Weaknesses & Gaps

### 1. Session Reuse Limitation (Fundamental)

**Impact**: HIGH - 3-6 second latency per tool continuation

**Root Cause**: OpenAI API model requires closing HTTP response to return tool_calls, while Cursor expects persistent bidirectional stream.

**Current Mitigation**: Fresh request with full conversation history via `messagesToPrompt()`.

**Potential Solutions**:
- WebSocket-based protocol (would require OpenCode support)
- State persistence on Cursor's backend (outside project control)
- Predictive pre-warming (complex, may not help)

### 2. Limited Error Recovery

**Issues**:
- No automatic retry on transient failures (except base URL fallback)
- No circuit breaker pattern
- SSE disconnections require full restart

### 3. Missing Features

| Feature | Priority | Notes |
|---------|----------|-------|
| Embeddings API | Medium | Not exposed by Cursor's Agent API |
| Image generation | Low | Not available via Cursor |
| Vision/multimodal | Medium | Partial - images in messages not fully handled |
| Request batching | Low | Would need OpenCode support |
| Response caching | Low | Could be added at proxy level |

### 4. Test Coverage Gaps

- No tests for OAuth flow (requires browser automation)
- No integration tests against real Cursor API (understandable)
- Limited error condition testing

### 5. Documentation of Protocol Details

The `docs/CURSOR_API.md` is intentionally high-level:

> "To keep the public repository lower-risk, this document is intentionally high-level... avoids publishing step-by-step protocol recipes, internal header requirements"

This makes it harder for others to understand the implementation without reading code.

---

## Recommendations for Our Project

### 1. Adopt the Custom Fetch Pattern

**Recommendation**: Use a custom fetch handler instead of a proxy server for OpenCode integration.

**Benefits**:
- Simpler deployment (no separate process)
- Better performance (no HTTP hop)
- Cleaner architecture

**Implementation Pattern**:
```typescript
// Create shared request handler
export function createRequestHandler(options: RequestHandlerOptions) {
  return async function handleRequest(req: Request): Promise<Response> {
    // Route to appropriate handler
    if (pathname === "/v1/chat/completions") {
      return handleChatCompletions(req, accessToken);
    }
    // ...
  };
}

// Wrap for plugin use
export function createPluginFetch(options: RequestHandlerOptions) {
  const handler = createRequestHandler(options);
  return async (input, init) => {
    const request = new Request(input, init);
    return handler(request);
  };
}
```

### 2. Implement Robust Token Management

**Recommendation**: Adopt their token refresh pattern with JWT expiration detection.

**Key Components**:
- `decodeJwtPayload()` for expiration extraction
- `isTokenExpiringSoon()` with configurable buffer (5 minutes default)
- Automatic refresh in the loader before token expires
- Fallback to stored credentials

### 3. Study Their Protobuf Implementation

**Recommendation**: Use their protobuf encoding/decoding approach for ACP protocol.

**Key Techniques**:
- Manual varint encoding/decoding
- Field tag calculation: `(fieldNumber << 3) | wireType`
- Length-delimited string handling
- Connect-RPC envelope format (5-byte header)

### 4. Implement Performance Timing

**Recommendation**: Add optional timing metrics for debugging.

```typescript
function createTimingMetrics() {
  return {
    requestStart: Date.now(),
    chunkCount: 0,
    textChunks: 0,
    toolCalls: 0,
    // ...
  };
}
```

### 5. Handle Session Architecture Differently

**Recommendation**: If we face similar session/state issues, consider:

1. **Stateless Design**: Accept the fresh-request-with-history pattern
2. **Pre-warming**: Keep connections warm when tool calls are expected
3. **WebSocket Negotiation**: Detect if client supports WebSocket, use if available

### 6. Tool Call ID Format

**Recommendation**: Use their session-aware tool call ID format:

```typescript
export function makeToolCallId(sessionId: string, callBase: string): string {
  return `sess_${sessionId}__call_${callBase}`;
}
```

This enables session tracking through tool call results.

### 7. Model Discovery Pattern

**Recommendation**: Dynamically fetch models from the API rather than hardcoding.

```typescript
// In loader
const cursorClient = new CursorClient(accessToken);
const models = await listCursorModels(cursorClient);
for (const m of models) {
  provider.models[modelID] = {
    id: modelID,
    capabilities: { /* detected from model */ },
    limit: getModelLimits(modelID),
    // ...
  };
}
```

### 8. Environment-Based Configuration

**Recommendation**: Use environment variables for feature flags:

```typescript
const DEBUG = process.env.CURSOR_DEBUG === "1";
const TIMING_ENABLED = process.env.CURSOR_TIMING === "1" || DEBUG;
const SESSION_REUSE_ENABLED = process.env.CURSOR_SESSION_REUSE !== "0";
```

---

## Competitive Position

### vs. opencode-cursor-auth (POSO-PocketSolutions)

Based on the README note:

> "Check out opencode-cursor-auth by POSO-PocketSolutions - another implementation you may want to consider"

**This Project's Advantages**:
- Full tool calling support (appears more complete)
- Session management infrastructure
- Comprehensive documentation
- Performance timing metrics
- Dual-mode (plugin + server)

**Potential Disadvantages**:
- May be more complex than needed for simple use cases
- Session reuse limitation adds latency

### vs. Simple API Proxy

**Advantages**:
- No separate server process required
- Better error handling
- Token refresh automation
- Model discovery

**Disadvantages**:
- More complex codebase
- Tightly coupled to Cursor's protocol

---

## Conclusion

The `yet-another-opencode-cursor-auth` project represents a **sophisticated, production-grade implementation** of an OpenCode plugin for Cursor integration. Its key innovations are:

1. **Custom fetch handler pattern** eliminating proxy server requirements
2. **Complete protocol implementation** including protobuf, gRPC-Web, and bidirectional streaming
3. **Comprehensive tool calling** with full lifecycle support
4. **Robust authentication** with automatic token refresh
5. **Performance monitoring** with detailed timing metrics

The primary limitation is **architectural**: the mismatch between OpenAI's stateless request/response model and Cursor's stateful bidirectional streaming creates unavoidable latency for tool call continuations (~3-6s). This is acknowledged and well-documented.

**For our project**, the most valuable patterns to adopt are:
- Custom fetch handler for serverless integration
- Token management with JWT expiration detection
- Protobuf encoding/decoding techniques
- Performance timing infrastructure
- Model discovery and dynamic registration

The codebase demonstrates excellent software engineering practices, comprehensive documentation, and deep technical understanding of both the OpenCode plugin interface and Cursor's internal protocols.

---

## Appendix: Key Files Reference

| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/api/agent-service.ts` | Agent API client | 1213 |
| `src/lib/openai-compat/handler.ts` | OpenAI request handler | 916 |
| `src/plugin/plugin.ts` | OpenCode plugin | 427 |
| `src/lib/auth/login.ts` | OAuth PKCE flow | 253 |
| `src/lib/session-reuse.ts` | Session management | 324 |
| `src/lib/api/proto/` | Protobuf implementation | ~2000 |
| `src/lib/openai-compat/types.ts` | OpenAI types | 151 |
| `src/lib/storage.ts` | Credential storage | 198 |

---

*End of Audit Report*
