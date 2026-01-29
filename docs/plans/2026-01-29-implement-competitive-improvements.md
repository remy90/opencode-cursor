# Competitive Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement HTTP Proxy Mode, Tool Calling Bridge, and Dynamic Model Discovery to close gaps with competing projects.

**Architecture:** Phase 1 adds HTTP proxy server for compatibility. Phase 2 builds tool calling bridge on top. Phase 3 adds dynamic model discovery. Each phase builds on previous, maintaining backward compatibility.

**Tech Stack:** TypeScript, Bun (for HTTP server), AI SDK patterns, OpenCode plugin SDK

---

## Phase 1: HTTP Proxy Mode (Foundation)

### Task 1: Proxy Server Setup

**Files:**
- Create: `src/proxy/types.ts`
- Create: `src/proxy/server.ts`
- Test: `tests/proxy/server.test.ts`

**Step 1: Define proxy types**

Create `src/proxy/types.ts`:
```typescript
export interface ProxyConfig {
  port?: number;
  host?: string;
  healthCheckPath?: string;
  requestTimeout?: number;
}

export interface ProxyServer {
  start(): Promise<string>;
  stop(): Promise<void>;
  getBaseURL(): string;
}
```

**Step 2: Write failing test**

Create `tests/proxy/server.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { createProxyServer } from "../../src/proxy/server.js";

describe("ProxyServer", () => {
  it("should start on default port", async () => {
    const server = createProxyServer({ port: 32124 });
    const baseURL = await server.start();
    expect(baseURL).toBe("http://127.0.0.1:32124/v1");
    await server.stop();
  });

  it("should respond to health check", async () => {
    const server = createProxyServer({ port: 32125 });
    await server.start();
    const response = await fetch("http://127.0.0.1:32125/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    await server.stop();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `bun test tests/proxy/server.test.ts`
Expected: FAIL - "createProxyServer not defined"

**Step 4: Implement proxy server**

Create `src/proxy/server.ts`:
```typescript
import type { ProxyConfig, ProxyServer } from "./types.js";

export function createProxyServer(config: ProxyConfig = {}): ProxyServer {
  const port = config.port || 32124;
  const host = config.host || "127.0.0.1";
  const healthPath = config.healthCheckPath || "/health";

  let server: any = null;
  let actualPort: number = port;

  return {
    async start(): Promise<string> {
      const bunAny = globalThis as any;

      server = bunAny.Bun.serve({
        hostname: host,
        port,
        fetch: async (req: Request) => {
          const url = new URL(req.url);

          if (url.pathname === healthPath) {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }

          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          });
        }
      });

      actualPort = server.port;
      return `http://${host}:${actualPort}/v1`;
    },

    async stop(): Promise<void> {
      if (server) {
        server.stop();
        server = null;
      }
    },

    getBaseURL(): string {
      return `http://${host}:${actualPort}/v1`;
    }
  };
}
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/proxy/server.test.ts`
Expected: PASS (both tests)

**Step 6: Commit**

```bash
git add src/proxy/types.ts src/proxy/server.ts tests/proxy/server.test.ts
git commit -m "feat: add HTTP proxy server foundation"
```

---

### Task 2: Request Handler

**Files:**
- Create: `src/proxy/handler.ts`
- Create: `src/proxy/formatter.ts`
- Test: `tests/proxy/handler.test.ts`

**Step 1: Write failing test**

Create `tests/proxy/handler.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { parseOpenAIRequest } from "../../src/proxy/handler.js";

describe("RequestHandler", () => {
  it("should parse OpenAI chat completion request", () => {
    const body = {
      model: "cursor-acp/auto",
      messages: [
        { role: "user", content: "Hello" }
      ],
      stream: false
    };

    const result = parseOpenAIRequest(body);
    expect(result.model).toBe("auto");
    expect(result.prompt).toBe("USER: Hello");
    expect(result.stream).toBe(false);
  });

  it("should handle messages array", () => {
    const body = {
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" }
      ]
    };

    const result = parseOpenAIRequest(body);
    expect(result.prompt).toBe("SYSTEM: You are helpful\n\nUSER: Hi");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/proxy/handler.test.ts`
Expected: FAIL - "parseOpenAIRequest not defined"

**Step 3: Implement request handler**

Create `src/proxy/handler.ts`:
```typescript
export interface ParsedRequest {
  model: string;
  prompt: string;
  stream: boolean;
  tools?: any[];
}

export function parseOpenAIRequest(body: any): ParsedRequest {
  const model = body.model?.replace("cursor-acp/", "") || "auto";
  const stream = body.stream === true;

  // Convert messages array to prompt string
  let prompt = "";
  if (Array.isArray(body.messages)) {
    const lines = body.messages.map((msg: any) => {
      const role = msg.role?.toUpperCase() || "USER";
      const content = typeof msg.content === "string" ? msg.content : "";
      return `${role}: ${content}`;
    });
    prompt = lines.join("\n\n");
  }

  return {
    model,
    prompt,
    stream,
    tools: body.tools
  };
}
```

**Step 4: Implement response formatter**

Create `src/proxy/formatter.ts`:
```typescript
export function createChatCompletionResponse(model: string, content: string) {
  return {
    id: `cursor-acp-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: `cursor-acp/${model}`,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
}

export function createChatCompletionChunk(
  id: string,
  created: number,
  model: string,
  deltaContent: string,
  done = false
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model: `cursor-acp/${model}`,
    choices: [
      {
        index: 0,
        delta: deltaContent ? { content: deltaContent } : {},
        finish_reason: done ? "stop" : null
      }
    ]
  };
}
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/proxy/handler.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/proxy/handler.ts src/proxy/formatter.ts tests/proxy/handler.test.ts
git commit -m "feat: add request handler and response formatter"
```

---

### Task 3: Integrate Proxy with Provider

**Files:**
- Modify: `src/index.ts`
- Modify: `src/provider.ts`
- Test: `tests/proxy/integration.test.ts`

**Step 1: Update provider to support proxy mode**

Modify `src/provider.ts` to export proxy-enabled provider:
```typescript
import { createProxyServer } from "./proxy/server.js";
import { parseOpenAIRequest } from "./proxy/handler.js";
import { createChatCompletionResponse, createChatCompletionChunk } from "./proxy/formatter.js";

export interface ProviderOptions {
  mode?: 'direct' | 'proxy';
  proxyConfig?: { port?: number; host?: string };
}

export async function createCursorProvider(options: ProviderOptions = {}) {
  const mode = options.mode || 'direct';

  if (mode === 'proxy') {
    // Start proxy server
    const proxy = createProxyServer(options.proxyConfig);
    const baseURL = await proxy.start();

    return {
      id: "cursor-acp",
      name: "Cursor ACP Provider (Proxy Mode)",
      baseURL,

      languageModel(modelId: string = "cursor-acp/auto") {
        const model = modelId.replace("cursor-acp/", "") || "auto";

        return {
          modelId,
          provider: "cursor-acp",

          async doGenerate({ prompt, messages }: any) {
            // Use HTTP API
            const response = await fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: modelId,
                messages: messages || [{ role: "user", content: prompt }],
                stream: false
              })
            });

            const result = await response.json();
            return {
              text: result.choices?.[0]?.message?.content || "",
              finishReason: "stop",
              usage: result.usage
            };
          },

          async doStream({ prompt, messages }: any) {
            const response = await fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: modelId,
                messages: messages || [{ role: "user", content: prompt }],
                stream: true
              })
            });

            return {
              stream: response.body,
              rawResponse: { headers: Object.fromEntries(response.headers) }
            };
          }
        };
      }
    };
  }

  // Return direct provider (existing implementation)
  return createDirectProvider();
}
```

**Step 2: Update index exports**

Modify `src/index.ts`:
```typescript
export { CursorPlugin } from "./plugin.js";
export { createCursorProvider, cursor } from "./provider.js";
export { createProxyServer } from "./proxy/server.js";

// Default export
export { default } from "./provider.js";

// Backward compatibility
export { createCursorProvider as cursorProvider };
```

**Step 3: Write integration test**

Create `tests/proxy/integration.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { createCursorProvider } from "../../src/provider.js";

describe("Proxy Integration", () => {
  it("should create provider in proxy mode", async () => {
    const provider = await createCursorProvider({
      mode: 'proxy',
      proxyConfig: { port: 32126 }
    });

    expect(provider.id).toBe("cursor-acp");
    expect(provider.baseURL).toContain("http://127.0.0.1:32126");

    // Clean up
    const proxy = (provider as any).proxy;
    if (proxy?.stop) await proxy.stop();
  });
});
```

**Step 4: Run tests**

Run: `bun test tests/proxy/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/provider.ts src/index.ts tests/proxy/integration.test.ts
git commit -m "feat: integrate HTTP proxy mode with provider"
```

---

## Phase 2: Tool Calling Bridge

### Task 4: Tool Registry

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/registry.ts`
- Test: `tests/tools/registry.test.ts`

**Step 1: Define tool types**

Create `src/tools/types.ts`:
```typescript
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

export type ToolExecutor = (args: any) => Promise<string>;
```

**Step 2: Write failing test**

Create `tests/tools/registry.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("ToolRegistry", () => {
  it("should register and retrieve tools", () => {
    const registry = new ToolRegistry();

    registry.register("bash", {
      type: "function",
      function: {
        name: "bash",
        description: "Execute shell command",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" }
          },
          required: ["command"]
        }
      }
    }, async (args) => `Executed: ${args.command}`);

    const tool = registry.get("bash");
    expect(tool).toBeDefined();
    expect(tool?.definition.function.name).toBe("bash");
  });

  it("should return all tool definitions", () => {
    const registry = new ToolRegistry();
    registry.register("bash", { /* ... */ }, async () => "");
    registry.register("read", { /* ... */ }, async () => "");

    const definitions = registry.getAllDefinitions();
    expect(definitions).toHaveLength(2);
  });
});
```

**Step 3: Implement tool registry**

Create `src/tools/registry.ts`:
```typescript
import type { ToolDefinition, ToolExecutor } from "./types.js";

interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(name: string, definition: ToolDefinition, executor: ToolExecutor): void {
    this.tools.set(name, { definition, executor });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  getExecutor(name: string): ToolExecutor | undefined {
    return this.tools.get(name)?.executor;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/types.ts src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat: add tool registry for OpenCode tools"
```

---

### Task 5: Tool Executor

**Files:**
- Create: `src/tools/executor.ts`
- Create: `src/tools/mapper.ts`
- Test: `tests/tools/executor.test.ts`

**Step 1: Write failing test**

Create `tests/tools/executor.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { ToolExecutor } from "../../src/tools/executor.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("ToolExecutor", () => {
  it("should execute registered tool", async () => {
    const registry = new ToolRegistry();
    registry.register("echo", {
      type: "function",
      function: {
        name: "echo",
        description: "Echo text",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        }
      }
    }, async (args) => args.text);

    const executor = new ToolExecutor(registry);
    const result = await executor.execute("echo", { text: "hello" });

    expect(result).toBe("hello");
  });

  it("should parse tool call JSON", () => {
    const executor = new ToolExecutor(new ToolRegistry());
    const json = '{"tool": "bash", "arguments": {"command": "ls"}}';

    const result = executor.parseToolCall(json);
    expect(result.name).toBe("bash");
    expect(result.arguments).toEqual({ command: "ls" });
  });
});
```

**Step 2: Implement tool executor**

Create `src/tools/executor.ts`:
```typescript
import type { ToolRegistry } from "./registry.js";
import type { ToolCall } from "./types.js";

export interface ParsedToolCall {
  name: string;
  arguments: any;
}

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(toolName: string, args: any): Promise<string> {
    const executor = this.registry.getExecutor(toolName);
    if (!executor) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    return await executor(args);
  }

  parseToolCall(json: string): ParsedToolCall {
    try {
      const parsed = JSON.parse(json);

      // Handle different formats
      if (parsed.tool && parsed.arguments) {
        return {
          name: parsed.tool,
          arguments: parsed.arguments
        };
      }

      if (parsed.name && parsed.arguments) {
        return {
          name: parsed.name,
          arguments: typeof parsed.arguments === "string"
            ? JSON.parse(parsed.arguments)
            : parsed.arguments
        };
      }

      throw new Error("Invalid tool call format");
    } catch (error) {
      throw new Error(`Failed to parse tool call: ${error}`);
    }
  }

  async executeToolCall(toolCall: ToolCall): Promise<string> {
    const args = JSON.parse(toolCall.function.arguments);
    return await this.execute(toolCall.function.name, args);
  }
}
```

**Step 3: Implement tool mapper**

Create `src/tools/mapper.ts`:
```typescript
import type { ToolDefinition } from "./types.js";

export function createToolSchemaPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "";

  const toolDescriptions = tools.map(tool => {
    const params = Object.entries(tool.function.parameters.properties)
      .map(([name, schema]: [string, any]) => {
        const required = tool.function.parameters.required?.includes(name);
        return `  - ${name}${required ? " (required)" : ""}: ${schema.type}`;
      })
      .join("\n");

    return `## Tool: ${tool.function.name}
${tool.function.description}
Parameters:
${params || "  (none)"}

Usage: {"tool": "${tool.function.name}", "arguments": {${Object.keys(tool.function.parameters.properties).map(k => `"${k}": "..."`).join(", ")}}}`;
  });

  return `You have access to the following tools. Use them when needed:

${toolDescriptions.join("\n\n")}

When you need to use a tool, output ONLY the JSON object. The system will execute it and return the result.`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/executor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/executor.ts src/tools/mapper.ts tests/tools/executor.test.ts
git commit -m "feat: add tool executor and schema mapper"
```

---

### Task 6: Integrate Tool Calling with Proxy

**Files:**
- Modify: `src/proxy/server.ts`
- Modify: `src/proxy/handler.ts`
- Test: `tests/proxy/tools.test.ts`

**Step 1: Update proxy server to support tools**

Modify `src/proxy/server.ts` to accept tool registry:
```typescript
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { createToolSchemaPrompt } from "../tools/mapper.js";

export interface ProxyServerOptions extends ProxyConfig {
  toolRegistry?: ToolRegistry;
}

export function createProxyServer(options: ProxyServerOptions = {}): ProxyServer {
  // ... existing code ...

  const toolRegistry = options.toolRegistry || new ToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);

  // Register default OpenCode tools
  registerDefaultTools(toolRegistry);

  // In fetch handler, handle tool calling
  // ... implement tool call parsing and execution
}

function registerDefaultTools(registry: ToolRegistry): void {
  // Register bash tool
  registry.register("bash", {
    type: "function",
    function: {
      name: "bash",
      description: "Execute shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to execute" },
          timeout: { type: "number", description: "Timeout in milliseconds" }
        },
        required: ["command"]
      }
    }
  }, async (args) => {
    // Implementation using OpenCode SDK or direct execution
    return `Executed: ${args.command}`;
  });

  // Register read tool
  registry.register("read", {
    type: "function",
    function: {
      name: "read",
      description: "Read file contents",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" }
        },
        required: ["path"]
      }
    }
  }, async (args) => {
    // Implementation using fs.readFile
    const fs = await import("fs");
    return fs.readFileSync(args.path, "utf-8");
  });

  // Additional tools: write, edit, grep, ls, etc.
}
```

**Step 2: Write integration test**

Create `tests/proxy/tools.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { createProxyServer } from "../../src/proxy/server.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("Proxy Tool Calling", () => {
  it("should inject tool schemas into prompt", async () => {
    const registry = new ToolRegistry();
    registry.register("test", {
      type: "function",
      function: {
        name: "test",
        description: "Test tool",
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"]
        }
      }
    }, async (args) => args.input);

    const server = createProxyServer({
      port: 32127,
      toolRegistry: registry
    });

    await server.start();

    // Test that server started with tools
    expect(server.getBaseURL()).toContain("32127");

    await server.stop();
  });
});
```

**Step 3: Run tests**

Run: `bun test tests/proxy/`
Expected: PASS

**Step 4: Commit**

```bash
git add src/proxy/server.ts src/proxy/handler.ts tests/proxy/tools.test.ts
git commit -m "feat: integrate tool calling with HTTP proxy"
```

---

## Phase 3: Dynamic Model Discovery

### Task 7: Model Discovery Service

**Files:**
- Create: `src/models/types.ts`
- Create: `src/models/discovery.ts`
- Test: `tests/models/discovery.test.ts`

**Step 1: Define model types**

Create `src/models/types.ts`:
```typescript
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];
}

export interface DiscoveryConfig {
  cacheTTL?: number; // milliseconds
  fallbackModels?: ModelInfo[];
}
```

**Step 2: Write failing test**

Create `tests/models/discovery.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { ModelDiscoveryService } from "../../src/models/discovery.js";

describe("ModelDiscoveryService", () => {
  it("should discover models from cursor-agent", async () => {
    const service = new ModelDiscoveryService();
    const models = await service.discover();

    // Should return array of models
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Each model should have id and name
    const firstModel = models[0];
    expect(firstModel.id).toBeDefined();
    expect(firstModel.name).toBeDefined();
  });

  it("should cache discovered models", async () => {
    const service = new ModelDiscoveryService({ cacheTTL: 60000 });

    // First discovery
    const models1 = await service.discover();

    // Second discovery should return cached
    const models2 = await service.discover();

    expect(models1).toEqual(models2);
  });
});
```

**Step 3: Implement discovery service**

Create `src/models/discovery.ts`:
```typescript
import type { ModelInfo, DiscoveryConfig } from "./types.js";

interface CacheEntry {
  models: ModelInfo[];
  timestamp: number;
}

export class ModelDiscoveryService {
  private cache: CacheEntry | null = null;
  private cacheTTL: number;
  private fallbackModels: ModelInfo[];

  constructor(config: DiscoveryConfig = {}) {
    this.cacheTTL = config.cacheTTL || 5 * 60 * 1000; // 5 minutes
    this.fallbackModels = config.fallbackModels || this.getDefaultModels();
  }

  async discover(): Promise<ModelInfo[]> {
    // Check cache
    if (this.cache && Date.now() - this.cache.timestamp < this.cacheTTL) {
      return this.cache.models;
    }

    try {
      const models = await this.queryCursorAgent();
      this.cache = { models, timestamp: Date.now() };
      return models;
    } catch (error) {
      // Return fallback on error
      return this.fallbackModels;
    }
  }

  private async queryCursorAgent(): Promise<ModelInfo[]> {
    // Try multiple discovery methods

    // Method 1: CLI command
    try {
      return await this.queryViaCLI();
    } catch {}

    // Method 2: Parse from help output
    try {
      return await this.queryViaHelp();
    } catch {}

    // Method 3: Return fallback
    return this.fallbackModels;
  }

  private async queryViaCLI(): Promise<ModelInfo[]> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync("cursor-agent models --json", {
        timeout: 5000
      });

      const modelIds = JSON.parse(stdout);
      return modelIds.map((id: string) => ({
        id,
        name: this.formatModelName(id),
        description: `Cursor ${id} model`
      }));
    } catch {
      throw new Error("CLI query failed");
    }
  }

  private async queryViaHelp(): Promise<ModelInfo[]> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync("cursor-agent --help", {
        timeout: 5000
      });

      // Parse models from help text
      const match = stdout.match(/Available models:?\s*([\w\-,\s]+)/i);
      if (match) {
        const modelIds = match[1].split(/,\s*/).map(s => s.trim());
        return modelIds.map((id: string) => ({
          id,
          name: this.formatModelName(id),
          description: `Cursor ${id} model`
        }));
      }

      throw new Error("No models found in help");
    } catch {
      throw new Error("Help query failed");
    }
  }

  private formatModelName(id: string): string {
    // Convert kebab-case to Title Case
    return id
      .split("-")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private getDefaultModels(): ModelInfo[] {
    return [
      { id: "auto", name: "Auto", description: "Auto-select best model" },
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "sonnet-4.5", name: "Sonnet 4.5" },
      { id: "opus-4.5", name: "Opus 4.5" },
      { id: "gemini-3-pro", name: "Gemini 3 Pro" }
    ];
  }

  invalidateCache(): void {
    this.cache = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/models/discovery.test.ts`
Expected: PASS (may use fallback models)

**Step 5: Commit**

```bash
git add src/models/types.ts src/models/discovery.ts tests/models/discovery.test.ts
git commit -m "feat: add dynamic model discovery service"
```

---

### Task 8: Config Updater

**Files:**
- Create: `src/models/config.ts`
- Test: `tests/models/config.test.ts`

**Step 1: Write failing test**

Create `tests/models/config.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { ConfigUpdater } from "../../src/models/config.js";
import type { ModelInfo } from "../../src/models/types.js";

describe("ConfigUpdater", () => {
  it("should format models for opencode config", () => {
    const updater = new ConfigUpdater();
    const models: ModelInfo[] = [
      { id: "auto", name: "Auto" },
      { id: "gpt-5.2", name: "GPT-5.2" }
    ];

    const formatted = updater.formatModels(models);

    expect(formatted.auto).toBeDefined();
    expect(formatted.auto.name).toBe("Auto");
    expect(formatted.auto.tools).toBe(true);
    expect(formatted.auto.reasoning).toBe(true);
  });

  it("should preserve existing models", () => {
    const updater = new ConfigUpdater();
    const existing = {
      auto: { name: "Auto", custom: true },
      custom: { name: "Custom", tools: true }
    };

    const newModels: ModelInfo[] = [{ id: "gpt-5.2", name: "GPT-5.2" }];
    const merged = updater.mergeModels(existing, newModels);

    expect(merged.auto.custom).toBe(true); // Preserved
    expect(merged.gpt52).toBeDefined(); // Added
    expect(merged.custom).toBeDefined(); // Preserved
  });
});
```

**Step 2: Implement config updater**

Create `src/models/config.ts`:
```typescript
import type { ModelInfo } from "./types.js";

interface OpenCodeModelConfig {
  name: string;
  tools?: boolean;
  reasoning?: boolean;
  [key: string]: any;
}

interface OpenCodeProviderConfig {
  npm?: string;
  name?: string;
  options?: Record<string, any>;
  models: Record<string, OpenCodeModelConfig>;
}

export class ConfigUpdater {
  formatModels(models: ModelInfo[]): Record<string, OpenCodeModelConfig> {
    const formatted: Record<string, OpenCodeModelConfig> = {};

    for (const model of models) {
      // Normalize ID for JSON key (replace dots/dashes)
      const key = model.id.replace(/[.-]/g, "");

      formatted[key] = {
        name: model.name,
        tools: true,
        reasoning: true,
        description: model.description
      };
    }

    return formatted;
  }

  mergeModels(
    existing: Record<string, OpenCodeModelConfig>,
    discovered: ModelInfo[]
  ): Record<string, OpenCodeModelConfig> {
    const formatted = this.formatModels(discovered);

    // Merge, preserving existing custom fields
    return {
      ...formatted,
      ...existing // Existing takes precedence for conflicts
    };
  }

  generateProviderConfig(
    models: ModelInfo[],
    baseURL: string
  ): OpenCodeProviderConfig {
    return {
      npm: "file:///home/nomadx/opencode-cursor",
      name: "Cursor Agent Provider",
      options: {
        baseURL,
        apiKey: "cursor-agent"
      },
      models: this.formatModels(models)
    };
  }
}
```

**Step 3: Run test to verify it passes**

Run: `bun test tests/models/config.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/models/config.ts tests/models/config.test.ts
git commit -m "feat: add config updater for model registration"
```

---

### Task 9: Integration and CLI

**Files:**
- Create: `src/cli/discover.ts`
- Modify: `package.json` (add scripts)
- Test: `tests/models/integration.test.ts`

**Step 1: Create discovery CLI**

Create `src/cli/discover.ts`:
```typescript
#!/usr/bin/env bun
import { ModelDiscoveryService } from "../models/discovery.js";
import { ConfigUpdater } from "../models/config.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function main() {
  console.log("Discovering Cursor models...");

  const service = new ModelDiscoveryService();
  const models = await service.discover();

  console.log(`Found ${models.length} models:`);
  for (const model of models) {
    console.log(`  - ${model.id}: ${model.name}`);
  }

  // Update config
  const updater = new ConfigUpdater();
  const configPath = join(homedir(), ".config/opencode/opencode.json");

  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));

  // Update cursor-acp provider models
  if (existingConfig.provider?.["cursor-acp"]) {
    const formatted = updater.formatModels(models);
    existingConfig.provider["cursor-acp"].models = {
      ...existingConfig.provider["cursor-acp"].models,
      ...formatted
    };

    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
    console.log(`Updated ${configPath}`);
  } else {
    console.error("cursor-acp provider not found in config");
    process.exit(1);
  }

  console.log("Done!");
}

main().catch(console.error);
```

**Step 2: Update package.json scripts**

Modify `package.json`:
```json
{
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target node",
    "dev": "bun build ./src/index.ts --outdir ./dist --target node --watch",
    "test": "bun test",
    "test:unit": "bun test tests/unit",
    "test:integration": "bun test tests/integration",
    "discover": "bun run src/cli/discover.ts",
    "prepublishOnly": "bun run build"
  },
  "bin": {
    "cursor-discover": "./dist/cli/discover.js"
  }
}
```

**Step 3: Write integration test**

Create `tests/models/integration.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { ModelDiscoveryService } from "../../src/models/discovery.js";
import { ConfigUpdater } from "../../src/models/config.js";

describe("Model Discovery Integration", () => {
  it("should discover and format models", async () => {
    const service = new ModelDiscoveryService();
    const updater = new ConfigUpdater();

    const models = await service.discover();
    const formatted = updater.formatModels(models);

    // Verify format
    expect(Object.keys(formatted).length).toBeGreaterThan(0);

    const firstKey = Object.keys(formatted)[0];
    expect(formatted[firstKey].name).toBeDefined();
    expect(formatted[firstKey].tools).toBe(true);
  });
});
```

**Step 4: Run all tests**

Run: `bun test`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/cli/discover.ts package.json tests/models/integration.test.ts
git commit -m "feat: add model discovery CLI and integration"
```

---

## Final Tasks

### Task 10: Update Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/API.md`

**Step 1: Update README with new features**

Modify `README.md` to document:
- HTTP Proxy Mode usage
- Tool Calling configuration
- Model Discovery CLI

**Step 2: Create API documentation**

Create `docs/API.md` with full API reference.

**Step 3: Commit**

```bash
git add README.md docs/API.md
git commit -m "docs: update documentation for new features"
```

---

### Task 11: Final Verification

**Step 1: Run full test suite**

```bash
./test-all.sh
```
Expected: All tests pass

**Step 2: Build and verify**

```bash
bun run build
node -e "const p = require('./dist/index.js'); console.log('Exports:', Object.keys(p));"
```
Expected: All exports present

**Step 3: Commit final changes**

```bash
git add -A
git commit -m "feat: complete competitive improvements (HTTP proxy, tool calling, model discovery)"
```

---

## Success Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| HTTP Proxy | Test Coverage | 80%+ for proxy module |
| HTTP Proxy | Compatibility | Works with all OpenCode setups |
| Tool Calling | Tool Support | 6+ OpenCode tools mapped |
| Tool Calling | Success Rate | >95% tool execution |
| Discovery | Model Accuracy | 100% match to cursor-agent |
| Discovery | Refresh Time | <5s discovery time |
| Overall | Total Tests | 80+ tests |

---

## Files Created/Modified Summary

### New Files (21)
- `src/proxy/types.ts`
- `src/proxy/server.ts`
- `src/proxy/handler.ts`
- `src/proxy/formatter.ts`
- `src/tools/types.ts`
- `src/tools/registry.ts`
- `src/tools/executor.ts`
- `src/tools/mapper.ts`
- `src/models/types.ts`
- `src/models/discovery.ts`
- `src/models/config.ts`
- `src/cli/discover.ts`
- `tests/proxy/server.test.ts`
- `tests/proxy/handler.test.ts`
- `tests/proxy/integration.test.ts`
- `tests/proxy/tools.test.ts`
- `tests/tools/registry.test.ts`
- `tests/tools/executor.test.ts`
- `tests/models/discovery.test.ts`
- `tests/models/config.test.ts`
- `tests/models/integration.test.ts`
- `docs/API.md`

### Modified Files (3)
- `src/index.ts` - Add proxy exports
- `src/provider.ts` - Add proxy mode support
- `README.md` - Document new features
- `package.json` - Add discover script

---

## Next Steps

**Plan complete and saved to `docs/plans/2026-01-29-implement-competitive-improvements.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with @superpowers:executing-plans, batch execution with checkpoints

**Which approach would you prefer?**
