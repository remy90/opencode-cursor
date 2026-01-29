# Competitive Improvements Design

> **Goal**: Implement HTTP Proxy Mode, Tool Calling Bridge, and Dynamic Model Discovery to close gaps with competing projects while maintaining our reliability advantages.

**Date**: 2026-01-29
**Based on**: Competitive analysis of poso-cursor-auth, cursor-opencode-auth, yet-another-opencode-cursor-auth, and opencode-rules

---

## Executive Summary

This design addresses three critical gaps identified in our competitive analysis:

1. **HTTP Proxy Mode** - Provides compatibility with OpenCode's standard provider infrastructure (what poso/Infiland have)
2. **Tool Calling Bridge** - Enables Cursor to use OpenCode's native tools for agent workflows (what poso/Yukaii have)
3. **Dynamic Model Discovery** - Auto-detects available models from cursor-agent (what Yukaii has)

These improvements maintain our unique strengths (E2BIG protection, real streaming, 55 tests) while adding the compatibility and flexibility users expect.

---

## Phase 1: HTTP Proxy Mode (Foundation)

### Purpose
Provides an OpenAI-compatible HTTP server as an alternative to direct provider mode. This enables compatibility with OpenCode setups that expect standard provider behavior.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenCode Agent                          │
│                      (Sisyphus, etc)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ OpenAI-compatible HTTP API
                       │ POST /v1/chat/completions
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    HTTP Proxy Mode                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ProxyServer  │→ │ OpenAI Req   │→ │ CursorClient │      │
│  │ (Bun.serve)  │  │ Parser       │  │ (our client) │      │
│  └──────────────┘  └──────────────┘  └──────┬───────┘      │
│        ↑                                    │               │
│        │                                    │ spawn         │
│        │                              ┌─────▼──────┐        │
│        │                              │ cursor-agent│       │
│        │                              │ (stdin/stdout)      │
│        │                              └─────┬──────┘       │
│        │                                    │               │
│  ┌─────┴────────┐  ┌──────────────┐  ┌──────┴──────┐       │
│  │ OpenAI Resp  │← │ Formatter    │← │ Parser      │       │
│  │ Generator    │  │              │  │ (JSON)      │       │
│  └──────────────┘  └──────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Components

#### 1. ProxyServer
- **File**: `src/proxy/server.ts`
- **Purpose**: HTTP server using `Bun.serve()`
- **Port**: 32124 (default), with fallback to random port
- **Endpoints**:
  - `GET /health` - Health check for discovery
  - `POST /v1/chat/completions` - Main endpoint
  - `GET /v1/models` - Model listing

#### 2. RequestHandler
- **File**: `src/proxy/handler.ts`
- **Purpose**: Convert OpenAI API requests to cursor-agent calls
- **Key Functions**:
  - Parse OpenAI request format (messages, tools, stream)
  - Extract model ID and normalize
  - Convert messages array to prompt string
  - Handle tool definitions if present

#### 3. ResponseFormatter
- **File**: `src/proxy/formatter.ts`
- **Purpose**: Format cursor-agent output as OpenAI responses
- **Formats**:
  - Non-streaming: Full JSON response
  - Streaming: Server-Sent Events (SSE) chunks
  - Tool calls: OpenAI tool_call format

#### 4. ModeSelector
- **File**: `src/index.ts` (updated)
- **Purpose**: Choose between direct provider and HTTP proxy
- **Logic**:
  - Check environment variable `CURSOR_MODE`
  - Default to direct provider (faster)
  - HTTP proxy when `CURSOR_MODE=proxy`

### Error Handling

1. **Port Conflicts**: Try default port, fallback to random port
2. **Proxy Startup Failure**: Log error, fall back to direct mode
3. **Request Parsing Errors**: Return 400 with OpenAI-compatible error JSON
4. **Cursor-Agent Errors**: Forward stderr as OpenAI error message
5. **Health Check Failures**: Return 503 for load balancer detection

### Configuration

```typescript
// src/proxy/types.ts
interface ProxyConfig {
  port?: number;           // Default: 32124
  host?: string;           // Default: '127.0.0.1'
  healthCheckPath?: string; // Default: '/health'
  fallbackOnError?: boolean; // Default: true
  requestTimeout?: number;  // Default: 30000ms
}
```

---

## Phase 2: Tool Calling Bridge (Agent Workflows)

### Purpose
Enables Cursor to invoke OpenCode's native tools (bash, read, write, etc.) by mapping OpenAI-compatible tool schemas to actual tool executions.

### Architecture

```
User Request with Tools
         │
         ▼
┌──────────────────────────────┐
│    Tool Schema Injection     │
│  Inject tool definitions     │
│  into cursor-agent prompt    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Cursor-Agent Processing  │
│  LLM decides to use tool     │
│  Outputs tool call JSON      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Tool Call Parser        │
│  Parse JSON from output      │
│  Extract tool name + args    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Tool Executor           │
│  Map to OpenCode tool        │
│  Execute via function call   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Tool Result Formatter    │
│  Format result as message    │
│  Inject back into context    │
└──────────────┬───────────────┘
               │
               ▼
      Final Response
```

### Components

#### 1. ToolRegistry
- **File**: `src/tools/registry.ts`
- **Purpose**: Discovers and manages available OpenCode tools
- **Tools Supported**:
  - `bash` / `shell` - Execute shell commands
  - `read` / `file_read` - Read file contents
  - `write` / `file_write` - Write file contents
  - `edit` / `file_edit` - Edit files
  - `grep` / `search` - Search files
  - `glob` / `list` - List files
  - `ls` - List directory

#### 2. ToolMapper
- **File**: `src/tools/mapper.ts`
- **Purpose**: Convert OpenAI tool schemas to executable tool calls
- **Schema Format**:
```json
{
  "type": "function",
  "function": {
    "name": "bash",
    "description": "Execute shell command",
    "parameters": {
      "type": "object",
      "properties": {
        "command": { "type": "string" },
        "timeout": { "type": "number" }
      },
      "required": ["command"]
    }
  }
}
```

#### 3. ToolExecutor
- **File**: `src/tools/executor.ts`
- **Purpose**: Execute OpenCode tools and return results
- **Execution**:
  - Import tool functions from OpenCode SDK
  - Execute with proper error handling
  - Format results for LLM consumption

#### 4. ConversationManager
- **File**: `src/tools/conversation.ts`
- **Purpose**: Maintain tool call state across requests
- **State Tracking**:
  - `tool_call_id` generation and mapping
  - Tool call history
  - Multi-turn tool workflows

### Tool Execution Flow

1. **Request with Tools**: User sends request with `tools` array
2. **Schema Injection**: Inject tool schemas into cursor-agent prompt
3. **LLM Decision**: Cursor-agent decides to use tool, outputs JSON
4. **Parse Tool Call**: Extract `name` and `arguments` from JSON
5. **Execute Tool**: Call matching OpenCode tool function
6. **Format Result**: Convert tool output to user message format
7. **Continue Conversation**: Send result back to cursor-agent
8. **Final Response**: Return completed response to user

### Tool Schema Injection Prompt

```
You have access to the following tools. Use them when needed:

## Tool: bash
Execute shell commands.
Parameters:
- command (required): The command to run
- timeout (optional): Timeout in milliseconds

Usage: {"tool": "bash", "arguments": {"command": "ls -la"}}

## Tool: read
Read file contents.
Parameters:
- path (required): File path to read

Usage: {"tool": "read", "arguments": {"path": "/path/to/file"}}

[Additional tools...]

When you need to use a tool, output ONLY the JSON object. The system will execute it and return the result.
```

---

## Phase 3: Dynamic Model Discovery (Auto-Configuration)

### Purpose
Eliminates hardcoded model lists by querying cursor-agent at runtime. This ensures our configuration always matches what cursor-agent supports.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Startup / Refresh                          │
│                   (Every 5 minutes)                         │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              ModelDiscoveryService                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Query CLI   │  │ Parse Output│  │ Cache Models│         │
│  │             │  │             │  │ (5-min TTL) │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              ConfigUpdater                                   │
│  Update opencode.json models section                        │
│  Preserve user customizations                               │
│  Handle model aliases                                       │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              RuntimeValidator                                │
│  Validate model before each request                         │
│  Fallback to auto if invalid                                │
│  Update cache on error                                      │
└─────────────────────────────────────────────────────────────┘
```

### Components

#### 1. ModelDiscoveryService
- **File**: `src/models/discovery.ts`
- **Purpose**: Query cursor-agent for available models
- **Discovery Methods**:
  1. **Primary**: `cursor-agent models --json` (if available)
  2. **Secondary**: Parse `cursor-agent --help` output
  3. **Tertiary**: Extract from error messages
  4. **Fallback**: Default hardcoded list

#### 2. ModelCache
- **File**: `src/models/cache.ts`
- **Purpose**: Cache discovered models with TTL
- **Features**:
  - 5-minute TTL
  - Background refresh (refresh at 4 minutes)
  - Immediate invalidation on errors
  - Persistent cache option (write to file)

#### 3. ConfigUpdater
- **File**: `src/models/config.ts`
- **Purpose**: Update OpenCode configuration
- **Behavior**:
  - Read existing `~/.config/opencode/opencode.json`
  - Merge discovered models
  - Preserve user additions
  - Handle model aliases (gpt-5 → gpt-5.2)
  - Write updated config

#### 4. ModelValidator
- **File**: `src/models/validator.ts`
- **Purpose**: Validate models at runtime
- **Logic**:
  - Check if model exists in cache
  - If not, trigger discovery
  - If invalid, fallback to 'auto'
  - Log validation results

### Discovery Sources

#### Source 1: CLI Command (Preferred)
```bash
cursor-agent models --json
# Returns: ["auto", "gpt-5.2", "sonnet-4.5", ...]
```

#### Source 2: Help Output Parsing
```bash
cursor-agent --help
# Parse: Available models: auto, gpt-5.2, sonnet-4.5, ...
```

#### Source 3: Error Message Extraction
When invalid model requested:
```
Error: Invalid model. Available models: auto, gpt-5.2, sonnet-4.5, ...
```

### Model Aliases

Maintain aliases for backward compatibility:
- `gpt-5` → `gpt-5.2`
- `claude-sonnet` → `sonnet-4.5`
- `claude-opus` → `opus-4.5`

---

## Integration: Three Phases Working Together

### Combined Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode Configuration                    │
│                   (Dynamic Models)                          │
│  Models discovered at runtime from cursor-agent             │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode Agent                            │
│                   (User Request)                            │
│  Request with tools: [bash, read, write]                   │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Proxy Mode                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Tool Schema Injection                              │   │
│  │  Inject tool definitions into prompt                │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Cursor-Agent Processing                            │   │
│  │  LLM outputs tool call JSON                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Tool Executor                                      │   │
│  │  Execute OpenCode tools                             │   │
│  │  Return results                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Response Formatter                                 │   │
│  │  Format as OpenAI response                          │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
              User
```

### Mode Selection Logic

```typescript
// Mode selection based on configuration
function selectMode(): ProviderMode {
  const mode = process.env.CURSOR_MODE || 'direct';

  switch (mode) {
    case 'proxy':
      return new HttpProxyMode();
    case 'auto':
      // Try direct, fallback to proxy on error
      return new AdaptiveMode();
    case 'direct':
    default:
      return new DirectProviderMode();
  }
}
```

---

## Testing Strategy

### Unit Tests

1. **ProxyServer Tests**
   - Port allocation (default + fallback)
   - Health check endpoint
   - Request parsing
   - Error handling

2. **Tool Calling Tests**
   - Tool schema injection
   - Tool call parsing
   - Tool execution
   - Error handling

3. **Model Discovery Tests**
   - CLI parsing
   - Cache behavior
   - Config updating
   - Alias resolution

### Integration Tests

1. **End-to-End Proxy Test**
   ```
   Start proxy → Send OpenAI request → Verify response
   ```

2. **Tool Workflow Test**
   ```
   Request with tools → Tool execution → Final response
   ```

3. **Model Discovery Test**
   ```
   Trigger discovery → Update config → Verify models
   ```

---

## Success Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| HTTP Proxy | Compatibility | Works with all OpenCode setups |
| HTTP Proxy | Performance | <100ms overhead vs direct |
| Tool Calling | Tool Support | 6+ OpenCode tools mapped |
| Tool Calling | Success Rate | >95% tool execution success |
| Discovery | Accuracy | 100% model list accuracy |
| Discovery | Refresh | <5s discovery time |

---

## Next Steps

1. **Validate Design** - Get approval on this document
2. **Create Implementation Plan** - Use superpowers:writing-plans
3. **Set Up Worktree** - Use superpowers:using-git-worktrees
4. **Implement Phase 1** - HTTP Proxy Mode
5. **Implement Phase 2** - Tool Calling Bridge
6. **Implement Phase 3** - Dynamic Model Discovery
7. **Run Full Test Suite** - Verify all 55+ tests pass
8. **Update Documentation** - README, API docs

---

## Appendix: File Structure

```
src/
├── index.ts                    # Mode selection + exports
├── provider.ts                 # Direct provider (existing)
├── client/
│   └── simple.ts              # CursorClient (existing)
├── proxy/
│   ├── server.ts              # HTTP proxy server
│   ├── handler.ts             # Request handler
│   ├── formatter.ts           # Response formatter
│   └── types.ts               # Proxy types
├── tools/
│   ├── registry.ts            # Tool registry
│   ├── mapper.ts              # Tool schema mapper
│   ├── executor.ts            # Tool executor
│   ├── conversation.ts        # Conversation manager
│   └── types.ts               # Tool types
├── models/
│   ├── discovery.ts           # Model discovery service
│   ├── cache.ts               # Model cache
│   ├── config.ts              # Config updater
│   ├── validator.ts           # Model validator
│   └── types.ts               # Model types
tests/
├── proxy/
│   ├── server.test.ts
│   ├── handler.test.ts
│   └── formatter.test.ts
├── tools/
│   ├── registry.test.ts
│   ├── mapper.test.ts
│   └── executor.test.ts
├── models/
│   ├── discovery.test.ts
│   ├── cache.test.ts
│   └── config.test.ts
└── integration/
    └── proxy-workflow.test.ts
```

---

*Design validated: 2026-01-29*
*Ready for implementation planning*
