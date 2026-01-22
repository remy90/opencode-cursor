# Hybrid ACP Implementation Design

**Date**: 2026-01-23
**Status**: Brainstorming Complete - Ready for Implementation Planning
**Approach**: Hybrid SDK + Custom Extensions

---

## Overview

Implement full Agent Client Protocol (ACP) compliance with a hybrid architecture that combines:
- **SDK-based ACP core** for protocol correctness and compatibility
- **Cursor native extensions** for usage, status, and model discovery
- **Robust infrastructure** for session persistence, retry logic, and structured logging

This approach improves on roshan-c/cursor-acp by adding session persistence, retry logic, enhanced tool metadata, and native cursor-agent feature support.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   OpenCode Plugin                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  CursorAcpHybridAgent (implements Agent)          │  │
│  │                                                     │  │
│  │  ┌──────────────────────────────────────────────┐      │  │
│  │  │  ACP Core (@agentclientprotocol/sdk)    │      │  │
│  │  │  - initialize()                              │      │  │
│  │  │  - newSession()                             │      │  │
│  │  │  - prompt()                                 │      │  │
│  │  │  - cancel()                                 │      │  │
│  │  │  - setSessionMode()                        │      │  │
│  │  └──────────────────────────────────────────────┘      │  │
│  │              │                                      │  │
│  │  ┌──────────────────────────────────────────────┐      │  │
│  │  │  Cursor Native Extensions                     │      │  │
│  │  │  - getUsage()                              │      │  │
│  │  │  - getStatus()                             │      │  │
│  │  │  - listModels()                            │      │  │
│  │  │  - getSessionInfo()                        │      │  │
│  │  └──────────────────────────────────────────────┘      │  │
│  │              │                                      │  │
│  │  ┌──────────────────────────────────────────────┐      │  │
│  │  │  Robust Infrastructure                      │      │  │
│  │  │  - SessionManager (persistent)             │      │  │
│  │  │  - RetryEngine (exponential backoff)      │      │  │
│  │  │  - ToolMapper (enhanced metadata)         │      │  │
│  │  │  - Logger (structured)                      │      │  │
│  │  │  - MetricsTracker (usage)                  │      │  │
│  │  └──────────────────────────────────────────────┘      │  │
│  │                                                     │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        ┌──────────────────────────┐
        │   cursor-agent         │
        │   (subprocess)         │
        └──────────────────────────┘
```

---

## Key Design Principles

1. **SDK for protocol correctness** - Don't reimplement ACP framing
2. **Native extensions for Cursor features** - Usage, status, models that cursor-agent supports
3. **Infrastructure for robustness** - Session persistence, retry logic, structured logging
4. **Class-based modularity** - Separate concerns, testable, maintainable
5. **Flawless with fallbacks** - Every operation has retry/recovery paths

---

## Core Components

### 1. CursorAcpHybridAgent (Main Entry Point)

```typescript
class CursorAcpHybridAgent implements Agent {
  // ACP SDK connection
  private client: AgentSideConnection;

  // Infrastructure modules
  private sessions: SessionManager;
  private retry: RetryEngine;
  private tools: ToolMapper;
  private metrics: MetricsTracker;
  private logger: Logger;

  // Cursor native extensions
  private cursor: CursorNativeWrapper;

  constructor(client: AgentSideConnection) {
    this.client = client;
    this.sessions = new SessionManager();
    this.retry = new RetryEngine({ maxRetries: 3, backoffBase: 1000 });
    this.tools = new ToolMapper();
    this.metrics = new MetricsTracker();
    this.logger = createLogger("CursorAcpAgent");
    this.cursor = new CursorNativeWrapper();
  }

  // ACP-required methods (delegated to SDK)
  async initialize(req: InitializeRequest): Promise<InitializeResponse>
  async newSession(params: NewSessionRequest): Promise<NewSessionResponse>
  async prompt(params: PromptRequest): Promise<PromptResponse>
  async cancel(params: CancelNotification): Promise<void>
  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse>

  // Cursor-specific extensions (beyond ACP)
  async getUsage(): Promise<CursorUsageStats>
  async getStatus(): Promise<CursorAgentStatus>
}
```

**Responsibilities:**
- Implements ACP Agent interface (protocol compliance)
- Orchestrates all infrastructure modules
- Provides Cursor-specific extensions
- Handles high-level error recovery

### 2. SessionManager (Persistent Session Tracking)

```typescript
class SessionManager {
  private sessions: Map<string, SessionState>;
  private storage: SessionStorage; // File-based persistence

  async createSession(params: NewSessionParams): Promise<SessionState> {
    const id = crypto.randomUUID();
    const state: SessionState = {
      id,
      cwd: params.cwd,
      mode: params.modeId || "default",
      resumeId: undefined,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(id, state);
    await this.storage.save(id, state);
    return state;
  }

  async getSession(id: string): Promise<SessionState | null>
  async updateSession(id: string, updates: Partial<SessionState>): Promise<void>
  async deleteSession(id: string): Promise<void>
  async loadPersistedSessions(): Promise<void>

  // Resume capability
  canResume(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!(session?.resumeId);
  }
}
```

**Key Features:**
- Session persistence to disk (survive crashes)
- Resume ID tracking from cursor-agent
- In-memory cache for fast access
- Automatic cleanup of stale sessions

### 3. RetryEngine (Exponential Backoff with Classification)

```typescript
class RetryEngine {
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: RetryContext
  ): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetries) {
      try {
        const result = await operation();
        this.logger.info(`Success on attempt ${attempt + 1}`, { context });
        return result;
      } catch (error) {
        lastError = error;

        if (!this.isRecoverable(error, context)) {
          this.logger.error(`Fatal error, not retrying`, { error, context });
          throw error; // Don't retry fatal errors
        }

        attempt++;
        const delay = this.calculateBackoff(attempt);
        this.logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, { error });
        await this.sleep(delay);
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded`, { cause: lastError });
  }

  private isRecoverable(error: Error, context: RetryContext): boolean {
    // Recoverable: timeout, network, rate limit
    if (error.message.includes("timeout")) return true;
    if (error.message.includes("ECONNREFUSED")) return true;
    if (error.message.includes("429")) return true; // Rate limit

    // Fatal: auth error, invalid config
    if (error.message.includes("Not logged in")) return false;
    if (error.message.includes("invalid model")) return false;

    return false;
  }

  private calculateBackoff(attempt: number): number {
    const delay = this.baseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(delay, this.maxDelayMs);
  }
}
```

**Improvements over current:**
- Distinguishes recoverable vs fatal errors
- Exponential backoff (1s, 2s, 4s, 8s)
- Per-operation context (prompt, tool, auth)
- Logging at each retry attempt

### 4. ToolMapper (Enhanced Metadata for Tools)

```typescript
class ToolMapper {
  async mapCursorEventToAcp(
    evt: CursorAgentEvent,
    sessionId: string
  ): Promise<AcpToolUpdate[]> {
    switch (evt.type) {
      case "tool_call":
        return this.handleToolCall(evt, sessionId);
      default:
        return [];
    }
  }

  private async handleToolCall(
    evt: CursorToolCallEvent,
    sessionId: string
  ): Promise<AcpToolUpdate[]> {
    const updates: AcpToolUpdate[] = [];
    const callId = evt.call_id;
    const toolKind = this.getToolKind(evt.tool_call);
    const args = evt.tool_call[toolKind]?.args || {};

    // Tool start (rich metadata)
    updates.push({
      sessionId,
      toolCallId: callId,
      title: this.buildToolTitle(toolKind, args),
      kind: this.inferToolType(toolKind),
      status: "pending",
      locations: this.extractLocations(args),
      rawInput: JSON.stringify(args),
      startTime: Date.now()
    });

    // Update to in_progress
    updates.push({
      sessionId,
      toolCallId: callId,
      status: "in_progress"
    });

    // Tool completion (with diffs)
    if (evt.subtype === "completed") {
      const result = evt.tool_call[toolKind]?.result;
      const update = await this.buildCompletionUpdate(callId, toolKind, args, result);
      updates.push(update);
    }

    return updates;
  }

  private async buildCompletionUpdate(
    callId: string,
    toolKind: string,
    args: any,
    result: any
  ): Promise<AcpToolUpdate> {
    const update: AcpToolUpdate = {
      sessionId: "", // Filled later
      toolCallId: callId,
      status: result?.error ? "failed" : "completed",
      rawOutput: JSON.stringify(result),
      endTime: Date.now(),
      durationMs: result?.endTime - result?.startTime
    };

    // Add locations from result
    const locations = this.extractResultLocations(result);
    if (locations) update.locations = locations;

    // Add content based on tool type
    if (toolKind === "writeToolCall") {
      update.content = [{
        type: "diff",
        path: args.path,
        oldText: result.oldText || null,
        newText: result.newText || args.fileText
      }];
    } else if (toolKind === "bashToolCall" || toolKind === "shellToolCall") {
      const output = result.output || "";
      const exitCode = result.exitCode;
      const text = exitCode !== undefined
        ? `Exit code: ${exitCode}\n${output || "(no output)"}`
        : output || "(no output)";
      update.content = [{
        type: "content",
        content: { type: "text", text: "```\n" + text + "\n```" }
      }];
    }

    return update;
  }
}
```

**Enhancements over roshan-c:**
- Duration tracking (start/end times)
- Diff rendering for write operations
- Better bash output formatting
- Location extraction from both args and results
- Comprehensive tool coverage

### 5. CursorNativeWrapper (Native Cursor-Agent Features)

```typescript
class CursorNativeWrapper {
  private agentPath: string;

  constructor() {
    this.agentPath = process.env.CURSOR_AGENT_EXECUTABLE || "cursor-agent";
  }

  async getUsage(): Promise<CursorUsageStats> {
    // Check cursor-agent's native usage tracking if available
    const result = await this.execCommand([ "--usage" ]);
    return this.parseUsageOutput(result.stdout);
  }

  async getStatus(): Promise<CursorAgentStatus> {
    // Check if cursor-agent is healthy
    const result = await this.execCommand([ "--status" ]);
    return {
      healthy: result.exitCode === 0,
      version: this.extractVersion(result.stdout),
      logged_in: result.stdout.includes("logged in")
    };
  }

  async listModels(): Promise<CursorModel[]> {
    // Query cursor-agent's available models (dynamic discovery)
    const result = await this.execCommand([ "--list-models" ]);
    return this.parseModelList(result.stdout);
  }

  private async execCommand(args: string[]): Promise<{ exitCode: number, stdout: string, stderr: string }> {
    const child = spawn(this.agentPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    // ... implementation
  }
}
```

**Features:**
- Native usage queries (tokens, costs, rate limits)
- Health checks and version info
- Dynamic model discovery
- Leverages cursor-agent's built-in capabilities

### 6. MetricsTracker (Usage Analytics)

```typescript
class MetricsTracker {
  private metrics: Map<string, PromptMetrics>;

  recordPrompt(sessionId: string, model: string, promptTokens: number) {
    const metrics: PromptMetrics = {
      sessionId,
      model,
      promptTokens,
      toolCalls: 0,
      duration: 0,
      timestamp: Date.now()
    };
    this.metrics.set(sessionId, metrics);
  }

  recordToolCall(sessionId: string, toolName: string, durationMs: number) {
    const metrics = this.metrics.get(sessionId);
    if (metrics) {
      metrics.toolCalls++;
      metrics.duration += durationMs;
    }
  }

  getSessionMetrics(sessionId: string): PromptMetrics | undefined {
    return this.metrics.get(sessionId);
  }

  getAggregateMetrics(lastHours: number = 24): AggregateMetrics {
    // Calculate usage over time window
    const cutoff = Date.now() - (lastHours * 60 * 60 * 1000);
    const relevant = Array.from(this.metrics.values()).filter(m => m.timestamp >= cutoff);

    return {
      totalPrompts: relevant.length,
      totalToolCalls: relevant.reduce((sum, m) => sum + m.toolCalls, 0),
      totalDuration: relevant.reduce((sum, m) => sum + m.duration, 0),
      avgDuration: relevant.length > 0
        ? relevant.reduce((sum, m) => sum + m.duration, 0) / relevant.length
        : 0
    };
  }
}
```

### 7. Logger (Structured Logging)

```typescript
function createLogger(prefix: string) {
  return {
    debug: (msg: string, meta?: any) =>
      console.error(`[${prefix}] ${msg}`, meta),
    info: (msg: string, meta?: any) =>
      console.error(`[${prefix}] ${msg}`, meta),
    warn: (msg: string, meta?: any) =>
      console.error(`[${prefix}] ${msg}`, meta),
    error: (msg: string, err?: any) =>
      console.error(`[${prefix}] ${msg}`, err)
  };
}
```

---

## Data Flow

### Prompt Request Flow

```
1. OpenCode calls Agent.newSession()
   ├─> SessionManager.createSession()
   │   └─> Persist to disk
   └─> Return session ID to OpenCode

2. OpenCode calls Agent.prompt()
   ├─> RetryEngine.executeWithRetry(() => prompt())
   │   ├─> Attempt 1: Spawn cursor-agent
   │   │   ├─> Send prompt via stdin
   │   │   ├─> Parse NDJSON from stdout
   │   │   ├─> ToolMapper.mapCursorEventToAcp()
   │   │   └─> client.sessionUpdate() for each event
   │   ├─> If success: return
   │   └─> If error: Check recoverable
   │       ├─> Recoverable: Retry with exponential backoff
   │       └─> Fatal: Throw to OpenCode
   └─> Send final stopReason
```

### Cancellation Flow

```
1. OpenCode calls Agent.cancel()
   ├─> SessionManager.getSession(sessionId)
   ├─> Update session.cancelled = true
   └─> Kill cursor-agent process (SIGTERM + 300ms SIGKILL)

2. cursor-agent exits
   ├─> Detect exit in prompt handler
   ├─> Check session.cancelled flag
   ├─> Wait 300ms for all updates to flush
   └─> Return { stopReason: "cancelled" }
```

---

## Error Handling Strategy

### Error Classification

| Error Type | Recoverable | Action | Retry Policy |
|-------------|--------------|---------|--------------|
| **Timeout** | ✅ | Retry with backoff | Max 3 attempts, 1s→2s→4s |
| **Network (ECONNREFUSED)** | ✅ | Retry with backoff | Max 3 attempts |
| **Rate Limit (429)** | ✅ | Retry with backoff | Max 3 attempts |
| **Not logged in** | ❌ | Don't retry | Return auth error |
| **Invalid model** | ❌ | Don't retry | Return config error |
| **Process crash (exit ≠ 0)** | ❌ | Don't retry | Return fatal error |

### Fallback Hierarchy

```
Primary: Try with current cursor-agent session
  └─> If fail with recoverable error:
    Secondary: Retry with exponential backoff (3x)
      └─> If still fail:
        Tertiary: Try with new session (no resume)
          └─> If still fail:
            Fatal: Return error with context and suggestions
```

---

## Testing Strategy

### Unit Tests
- SessionManager: create, retrieve, update, delete, persistence
- RetryEngine: backoff calculation, error classification, max retries
- ToolMapper: event parsing, location extraction, diff generation
- MetricsTracker: record, aggregate, time window filtering

### Integration Tests
- Full prompt flow (spawn, stream, parse, return)
- Cancellation flow (SIGTERM, flush, stopReason)
- Session persistence (write to disk, read back, resume)
- Retry flow (trigger recoverable error, verify backoff timing)

### Manual Tests
- Install in fresh OpenCode instance
- Run multi-turn conversation
- Trigger timeout (cancel long prompt)
- Crash recovery (kill plugin, restart, verify session resume)
- Verify in Zed/JetBrains (ACP compatibility)

---

## Implementation Phases

### Phase 1: Infrastructure Setup (Day 1)
- [ ] Create directory structure (src/, src/modules/, tests/)
- [ ] Set up TypeScript config
- [ ] Add @agentclientprotocol/sdk dependency
- [ ] Implement Logger module
- [ ] Implement SessionStorage (file-based)

### Phase 2: Core Components (Days 2-3)
- [ ] Implement SessionManager
- [ ] Implement RetryEngine
- [ ] Implement MetricsTracker
- [ ] Write unit tests for each

### Phase 3: ACP Integration (Days 4-5)
- [ ] Implement CursorAcpHybridAgent skeleton
- [ ] Wire up ACP SDK connection
- [ ] Implement initialize(), newSession(), prompt() stubs
- [ ] Test basic ACP flow with mock cursor-agent

### Phase 4: Cursor Native (Day 6)
- [ ] Implement CursorNativeWrapper
- [ ] Add getUsage(), getStatus(), listModels()
- [ ] Integrate with main agent

### Phase 5: Tool Mapping (Days 7-8)
- [ ] Implement ToolMapper
- [ ] Add enhanced metadata (duration, locations, diffs)
- [ ] Test with real cursor-agent tool events

### Phase 6: Full Integration (Days 9-10)
- [ ] Connect all components in CursorAcpHybridAgent
- [ ] Implement full prompt flow with streaming
- [ ] Add cancellation handling
- [ ] Add session persistence on each prompt

### Phase 7: Testing & Polish (Days 11-12)
- [ ] Write comprehensive unit tests
- [ ] Write integration tests
- [ ] Manual testing in OpenCode
- [ ] Manual testing in Zed/JetBrains
- [ ] Performance profiling
- [ ] Documentation updates

---

## Success Criteria

- ✅ All ACP protocol methods implemented
- ✅ Session persistence works across plugin restarts
- ✅ Retry logic handles recoverable errors correctly
- ✅ Tool calls include enhanced metadata (duration, diffs, locations)
- ✅ Cursor native features (usage, status) accessible
- ✅ Structured logging enabled for debugging
- ✅ Tests pass (unit + integration)
- ✅ Works in OpenCode, Zed, JetBrains (ACP compatibility)
- ✅ Fallback behavior tested and documented

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|-------|----------|-------------|
| **ACP SDK changes** | Breaking protocol changes | Pin SDK version, monitor releases |
| **cursor-agent API changes** | Feature breakage | Feature detection, graceful degradation |
| **Session persistence corruption** | Lost sessions | JSON validation, backup strategy |
| **Performance overhead** | Slower than current plugin | Profile, optimize hot paths |
| **Complexity increase** | Harder to maintain | Modular design, clear separation of concerns |
| **Testing matrix expansion** | More clients to test | Prioritize OpenCode, add others gradually |

---

## Open Questions

1. **Metrics storage** - Where to persist metrics? (File system vs SQLite vs in-memory only)
2. **Session cleanup** - How long to keep stale sessions? (24h? 7 days?)
3. **Feature flags** - Should we have flags to disable features? (e.g., NO_PERSISTENCE)
4. **Backward compatibility** - Should we maintain old OpenCode custom format as fallback?
5. **Error reporting** - How detailed should errors be? (Stack traces? User-friendly messages?)

---

## Dependencies

- `@agentclientprotocol/sdk` - ACP protocol implementation
- `crypto` - UUID generation (Node 18+ native, polyfill otherwise)
- TypeScript - Type safety
- Bun or Node.js - Runtime

---

## File Structure

```
src/
├── index.ts                 # Entry point (for backward compatibility)
├── acp/
│   ├── agent.ts           # CursorAcpHybridAgent
│   ├── sessions.ts        # SessionManager, SessionStorage
│   ├── retry.ts          # RetryEngine
│   ├── tools.ts          # ToolMapper
│   ├── cursor.ts         # CursorNativeWrapper
│   ├── metrics.ts        # MetricsTracker
│   └── logger.ts         # createLogger utility
├── types.ts                # Shared types
└── config.ts               # Configuration constants

tests/
├── unit/
│   ├── sessions.test.ts
│   ├── retry.test.ts
│   ├── tools.test.ts
│   └── metrics.test.ts
└── integration/
    └── agent.test.ts

docs/
└── plans/
    └── 2026-01-23-hybrid-acp-implementation-design.md
```

---

**Next Step**: Use writing-plans skill to create detailed implementation plan from this design.
