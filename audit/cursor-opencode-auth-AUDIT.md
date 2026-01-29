# Audit Report: cursor-opencode-auth

**Date**: 2026-01-29
**Auditor**: Claude Code Audit Agent
**Target Repository**: /home/nomadx/opencode-cursor/cursor-opencode-auth
**Version**: 0.1.1

---

## Executive Summary

- **Unique Architecture**: Uses a dual-mode approach with both a plugin (tools) and a local OpenAI-compatible bridge (provider), allowing OpenCode to both *call* Cursor and *use* Cursor as a model provider
- **Security-First Design**: Intentionally avoids reverse-engineering; only uses documented Cursor surfaces (CLI `agent` command and public Cloud Agents API)
- **Sandboxed Execution**: Implements `cursor_cli_patch` with git worktree isolation to prevent direct workspace modifications by Cursor
- **No Test Suite**: Project lacks automated tests despite complex process orchestration and API interactions
- **Clean TypeScript**: Well-structured ESM codebase with strict TypeScript configuration and modern Node.js patterns

---

## Architecture Analysis

### Monorepo Structure

```
cursor-opencode-auth/
├── packages/
│   ├── opencode-plugin-cursor/     # OpenCode plugin (tools)
│   └── cursor-openai-bridge/       # OpenAI-compatible HTTP bridge
├── docs/                           # PLAN.md, USAGE.md, SECURITY.md
└── examples/                       # Configuration examples
```

### Two-Package Architecture

#### 1. `opencode-plugin-cursor` (Plugin Tools)

**Location**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/`

**Purpose**: Adds OpenCode tools that invoke Cursor in controlled ways.

**Tool Categories**:

| Category | Tools | Purpose |
|----------|-------|---------|
| Bridge | `cursor_bridge_status`, `cursor_bridge_start`, `cursor_bridge_stop` | Manage the local OpenAI-compatible bridge process |
| CLI | `cursor_cli_status`, `cursor_cli_models`, `cursor_cli_run`, `cursor_cli_patch` | Direct Cursor CLI invocation |
| Cloud | `cursor_cloud_models`, `cursor_cloud_launch_agent`, `cursor_cloud_agent`, `cursor_cloud_conversation`, `cursor_cloud_followup`, `cursor_cloud_stop`, `cursor_cloud_delete`, `cursor_cloud_me`, `cursor_cloud_agents`, `cursor_cloud_repositories` | Cursor Cloud Agents API integration |

**Entry Point**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/index.ts`

```typescript
export const CursorPlugin: Plugin = async ({ client, directory, worktree }) => {
  const agentBin = getCursorAgentBin();
  const cwd = directory || process.cwd();
  const repoRoot = worktree || undefined;

  // Auto-create versioned plugin shim for /status display
  await ensurePluginShowsVersionInStatus(client).catch(() => undefined);

  // Auto-start bridge if needed
  await ensureBridgeProcess(agentBin, cwd);

  return {
    tool: {
      ...createBridgeTools({ agentBin, cwd }),
      ...createCliTools({ agentBin, cwd, repoRoot }),
      ...createCloudTools({ cwd }),
    },
  };
};
```

#### 2. `cursor-openai-bridge` (Provider Bridge)

**Location**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/cursor-openai-bridge/`

**Purpose**: Local HTTP server that translates OpenAI-compatible API calls to Cursor CLI commands.

**Endpoints**:
- `GET /health` - Health check with config info
- `GET /v1/models` - Lists available Cursor models (with 5-minute cache)
- `POST /v1/chat/completions` - Converts messages to Cursor CLI prompt and returns completion

**Key Design Decision**: Runs Cursor CLI in `--print` mode, converting OpenAI chat messages to a formatted prompt.

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/cursor-openai-bridge/src/lib/server.ts` (lines 77-179)

---

## Feature Comparison

### Supported Models

**Source of Truth**: `agent --list-models` command

**Approach**: Dynamic model discovery rather than hardcoded list. This allows immediate access to new Cursor models without code changes.

**Model ID Format**: Supports both `model-id` and `provider/model-id` formats (normalized to just `model-id` for Cursor CLI).

### Tool Calling

**Not Supported**: Neither the plugin nor the bridge implements tool calling. Cursor CLI in `--print` mode does not expose tool use capabilities to the bridge.

**Implication**: When used as a provider, Cursor cannot invoke OpenCode's tool loop. This is a significant limitation compared to native OpenCode providers.

### Streaming Support

**Limited**: The bridge supports SSE streaming (lines 125-162 in server.ts), but since Cursor CLI returns complete output, the stream emits the full response as a single chunk followed by `[DONE]`.

**Implementation**:
```typescript
// Pseudo-streaming - entire content in first chunk
res.write(`data: ${JSON.stringify({...content})}\n\n`);
res.write(`data: ${JSON.stringify({finish_reason: "stop"})}\n\n`);
res.write("data: [DONE]\n\n");
```

### Error Handling

**Strengths**:
- Clear error messages for authentication failures (401)
- Rate limiting awareness (429)
- Command-not-found detection with installation hints
- Git state validation before patch operations

**Weaknesses**:
- No retry logic for transient failures
- Bridge errors return generic 500 status codes
- Cloud API errors pass through raw without sanitization

---

## Code Quality Assessment

### TypeScript Patterns

**Grade: A-**

**Positives**:
- Strict TypeScript configuration (`strict: true`)
- ESM modules throughout
- Consistent use of explicit types for function parameters
- Proper use of `import type` for type-only imports

**Example** (from `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/lib/cursorApi.ts`):
```typescript
export type CursorApiAuthStyle = "basic" | "bearer";

export async function cursorApiRequest<T>(args: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  apiKey?: string;
  authStyle?: CursorApiAuthStyle;
  baseURL?: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  // Implementation
}
```

**Negatives**:
- Some `any` usage in message handling (line 2 in openai.ts: `messages: any[]`)
- Cloud tool args use `tool.schema` chain which lacks explicit typing

### Error Handling

**Grade: B+**

**Strengths**:
- Consistent try-catch blocks with meaningful error messages
- Specific handling for common error cases (ENOENT, auth failures)
- AbortController for timeout handling

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/lib/process.ts`
```typescript
child.on("error", (err: NodeJS.ErrnoException) => {
  if (timeout) clearTimeout(timeout);
  if (err?.code === "ENOENT") {
    reject(
      new Error(
        `Command not found: ${cmd}. Install Cursor CLI (agent) or set CURSOR_AGENT_BIN to its path.`,
      ),
    );
    return;
  }
  reject(err);
});
```

**Weaknesses**:
- Silent catches in some areas (e.g., `catch () { return undefined; }`)
- No structured error codes for programmatic handling

### Validation

**Grade: B**

**Strengths**:
- Environment variable validation with type coercion
- Model ID normalization
- URL parameter encoding for API calls

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/cursor-openai-bridge/src/lib/config.ts`
```typescript
function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}
```

**Weaknesses**:
- No runtime schema validation for API responses
- Limited input sanitization for CLI arguments

### Logging

**Grade: C**

**Assessment**:
- Minimal logging throughout
- No structured logging system
- Bridge uses console.log on startup only
- No debug/verbose mode for troubleshooting

**Recommendation**: Add a `DEBUG=cursor:*` style logging system.

---

## OpenCode Integration Analysis

### Plugin Registration

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/index.ts`

Uses the standard `@opencode-ai/plugin` SDK:
```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
```

### Auth Flow

**Cursor CLI Auth**:
1. Browser flow: `agent login`
2. API key: `CURSOR_API_KEY` environment variable

**Cloud Agents Auth**:
- `CURSOR_API_KEY` required
- Supports both Basic auth (`Basic base64(key:)`) and Bearer token

### Configuration

**Environment Variables**:

| Variable | Purpose | Default |
|----------|---------|---------|
| `CURSOR_AGENT_BIN` | Path to agent binary | "agent" |
| `CURSOR_API_KEY` | API key for Cloud Agents | - |
| `CURSOR_BRIDGE_HOST` | Bridge server host | "127.0.0.1" |
| `CURSOR_BRIDGE_PORT` | Bridge server port | 8765 |
| `CURSOR_BRIDGE_MODE` | Cursor mode (ask/plan/agent) | "ask" |
| `CURSOR_BRIDGE_FORCE` | Enable --force flag | false |
| `CURSOR_BRIDGE_STRICT_MODEL` | Pin to explicit model | true |
| `CURSOR_BRIDGE_WORKSPACE` | Working directory | process.cwd() |
| `CURSOR_BRIDGE_TIMEOUT_MS` | Request timeout | 300000 |

### Unique Plugin Shim Feature

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/lib/pluginShim.ts`

OpenCode only shows versions for npm plugins, not local file plugins. This module auto-creates versioned plugin files so `/status` displays the correct version.

**Implementation Highlights**:
- Detects if running from `dist/` (built) or `src/` (dev)
- Renames existing shim files to versioned names
- Creates new versioned shim if none exists
- Shows toast notification via OpenCode TUI

---

## Unique Strengths

### 1. **Git Worktree Sandbox (`cursor_cli_patch`)**

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/tools/cli.ts` (lines 138-314)

An elegant solution to prevent Cursor from directly modifying the workspace:

```typescript
// Creates isolated worktree from HEAD
const wtAdd = await run(
  "git",
  ["worktree", "add", "--detach", tempDir, "HEAD"],
  { cwd: args.repoRoot, timeoutMs: 60_000 },
);

// Runs Cursor with --force in isolated environment
const cursorRes = await run(args.agentBin, cmdArgs, {
  cwd: tempDir,  // <-- Key: runs in temp, not main workspace
  timeoutMs: toolArgs.timeoutMs,
});

// Extracts diff for OpenCode to apply
const diff = await run("git", ["diff", "--patch", "--binary"], {
  cwd: tempDir,
});
```

**Benefits**:
- Cursor cannot directly modify working tree
- OpenCode maintains control over patch application
- Better visibility and undo/redo semantics
- Automatic cleanup of temp worktree

### 2. **Dual Provider/Tool Architecture**

Unlike typical integrations that are either tools OR providers, this project offers both:

| Mode | Use Case |
|------|----------|
| **Tools** (`cursor_cli_*`) | Explicit Cursor invocation for specific tasks |
| **Provider** (`cursor/...`) | Transparent usage of Cursor models within OpenCode |

This flexibility is rare in AI IDE integrations.

### 3. **Comprehensive Cloud Agents Support**

Full lifecycle management for Cursor Cloud Agents:
- Launch agents with images, PR URLs, or repo refs
- Poll status and fetch conversations
- Send follow-up prompts
- Stop and delete agents
- List available repositories

### 4. **Security-First Documentation**

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/docs/SECURITY.md`

Explicitly documents:
- Cursor CLI permission configuration
- .env file protection recommendations
- Cloud Agents execution risks
- Git worktree behavior

Also provides example read-only CLI config:
```json
{
  "permissions": {
    "allow": ["Read(**/*)", "Shell(ls)", "Shell(git)"],
    "deny": ["Read(.env*)", "Write(**/*)", "Shell(rm)"]
  }
}
```

### 5. **Process Lifecycle Management**

**File**: `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/lib/bridge.ts`

Robust bridge process management:
- PID file tracking
- Health check polling
- Automatic startup on plugin load
- Graceful shutdown via SIGTERM
- Detached process spawning (survives OpenCode restart)

---

## Weaknesses and Gaps

### 1. **No Automated Tests**

**Critical Gap**: Zero test coverage despite:
- Complex process orchestration
- External API dependencies
- File system operations
- Git command execution

**Risk**: Changes to Cursor CLI output format could break model parsing without detection.

### 2. **No True Streaming**

The bridge's streaming is pseudo-streaming (single chunk). For long Cursor responses, users see no progress indication.

**Root Cause**: Cursor CLI `--print` mode returns complete output; no incremental output option.

### 3. **No Tool Calling Support**

When used as a provider (`cursor/gpt-5.2`), Cursor cannot invoke OpenCode's tools. This limits usefulness for agentic workflows.

**Architecture Constraint**: Cursor CLI `--print` mode doesn't expose tool use capabilities.

### 4. **Limited Error Recovery**

- No retry logic for transient Cloud API failures
- No exponential backoff for rate limiting
- Bridge crashes require manual restart

### 5. **Node.js Version Dependencies**

Uses modern Node.js features without explicit version checks:
- `fetch()` API (Node 18+)
- `AbortController`
- ESM modules

No `engines` field in package.json to warn users on older Node versions.

---

## Recommendations for Our Project

### Adopt

1. **Git Worktree Pattern**: The `cursor_cli_patch` approach is excellent for any tool that needs to sandbox external AI agents. Consider similar patterns for risky operations.

2. **Dual Architecture**: Having both tools AND provider modes increases user flexibility. Our implementation could benefit from this hybrid approach.

3. **Versioned Plugin Shims**: The `ensurePluginShowsVersionInStatus` pattern elegantly solves OpenCode's local plugin version display limitation.

4. **Security Documentation**: Their SECURITY.md sets a good standard for documenting risks and mitigations.

### Adapt

1. **Bridge Caching Strategy**: The 5-minute model list cache (line 57 in server.ts) is reasonable but could be configurable:
   ```typescript
   if (!modelCache || now - modelCache.at > 5 * 60_000) {
     // Refresh cache
   }
   ```

2. **Environment Configuration**: Their comprehensive env var configuration system is well-designed and could serve as a template.

### Avoid

1. **No Test Coverage**: Do not replicate the lack of tests. Critical paths (process spawning, API calls, git operations) need unit tests.

2. **Pseudo-Streaming**: If implementing streaming, ensure it's real incremental streaming, not single-chunk pseudo-streaming.

3. **Silent Error Swallowing**: Several `.catch(() => undefined)` patterns hide failures. Use explicit error handling with logging.

### Innovate Beyond

1. **Real-time Streaming**: Implement true streaming if the underlying API supports it (SSE or WebSocket).

2. **Tool Calling Bridge**: If possible, implement tool calling by parsing Cursor's internal tool use format (if documented).

3. **Health Monitoring**: Add metrics and health checks beyond the simple `/health` endpoint.

4. **Configuration Validation**: Add runtime validation of configuration with helpful error messages.

---

## Conclusion

**Overall Assessment**: Well-architected, security-conscious integration that successfully bridges two AI IDEs without reverse-engineering.

**Grade: B+**

**Key Differentiators**:
- Git worktree sandboxing is innovative and practical
- Dual provider/tool architecture offers flexibility
- Comprehensive Cloud Agents lifecycle support
- Strong security documentation

**Critical Improvements Needed**:
1. Add automated test suite (unit and integration)
2. Implement real streaming if technically feasible
3. Add structured logging
4. Document Node.js version requirements

**Competitive Position**: This is a reference implementation for ethical, documented API integration between AI tools. The architecture is sound and the security posture is commendable.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/index.ts` | Plugin entry point |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/tools/cli.ts` | CLI tools including `cursor_cli_patch` |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/tools/cloud.ts` | Cloud Agents API tools |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/lib/bridge.ts` | Bridge process management |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/opencode-plugin-cursor/src/lib/pluginShim.ts` | Versioned plugin shim creation |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/cursor-openai-bridge/src/lib/server.ts` | OpenAI-compatible HTTP server |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/packages/cursor-openai-bridge/src/lib/config.ts` | Bridge configuration |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/docs/PLAN.md` | Architecture documentation |
| `/home/nomadx/opencode-cursor/cursor-opencode-auth/docs/SECURITY.md` | Security considerations |

---

*End of Audit Report*
