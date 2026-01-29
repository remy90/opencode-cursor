import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";

const CURSOR_PROVIDER_ID = "cursor-acp";
const CURSOR_PROXY_HOST = "127.0.0.1";
const CURSOR_PROXY_DEFAULT_PORT = 32124;
const CURSOR_PROXY_DEFAULT_BASE_URL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/v1`;

function getGlobalKey(): string {
  return "__opencode_cursor_proxy_server__";
}

function createChatCompletionResponse(model: string, content: string) {
  return {
    id: `cursor-acp-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function createChatCompletionChunk(id: string, created: number, model: string, deltaContent: string, done = false) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: deltaContent ? { content: deltaContent } : {},
        finish_reason: done ? "stop" : null,
      },
    ],
  };
}

async function ensureCursorProxyServer(workspaceDirectory: string): Promise<string> {
  const key = getGlobalKey();
  const g = globalThis as any;

  const existingBaseURL = g[key]?.baseURL;
  if (typeof existingBaseURL === "string" && existingBaseURL.length > 0) {
    return existingBaseURL;
  }

  // Mark as starting to avoid duplicate starts in-process.
  g[key] = { baseURL: "" };

  const handler = async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
        return new Response(JSON.stringify({ error: `Unsupported path: ${url.pathname}` }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await req.json().catch(() => ({}));
      const messages: Array<any> = Array.isArray(body?.messages) ? body.messages : [];
      const stream = body?.stream === true;

      // Convert messages to prompt
      const lines: string[] = [];
      for (const message of messages) {
        const role = typeof message.role === "string" ? message.role : "user";
        const content = message.content;

        if (typeof content === "string") {
          lines.push(`${role.toUpperCase()}: ${content}`);
        } else if (Array.isArray(content)) {
          const textParts = content
            .map((part: any) => {
              if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
                return part.text;
              }
              return "";
            })
            .filter(Boolean);
          if (textParts.length) {
            lines.push(`${role.toUpperCase()}: ${textParts.join("\n")}`);
          }
        }
      }
      const prompt = lines.join("\n\n");
      const model = typeof body?.model === "string" ? body.model : "auto";

      const bunAny = globalThis as any;
      if (!bunAny.Bun?.spawn) {
        return new Response(JSON.stringify({ error: "This provider requires Bun runtime." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      const cmd = [
        "cursor-agent",
        "--print",
        "--output-format",
        "text",
        "--workspace",
        workspaceDirectory,
        "--model",
        model,
        prompt,
      ];

      const child = bunAny.Bun.spawn({
        cmd,
        stdout: "pipe",
        stderr: "pipe",
        env: bunAny.Bun.env,
      });

      if (!stream) {
        const [stdoutText, stderrText] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);

        const stdout = (stdoutText || "").trim();
        const stderr = (stderrText || "").trim();

        // cursor-agent sometimes returns non-zero even with usable stdout.
        // Treat stdout as success unless we have explicit stderr.
        if (child.exitCode !== 0 && stderr.length > 0) {
          return new Response(JSON.stringify({ error: stderr }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const payload = createChatCompletionResponse(model, stdout || stderr);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Streaming.
      const encoder = new TextEncoder();
      const id = `cursor-acp-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);

      const sse = new ReadableStream({
        async start(controller) {
          let closed = false;
          try {
            const decoder = new TextDecoder();
            const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!value || value.length === 0) continue;
              const text = decoder.decode(value, { stream: true });
              if (!text) continue;

              const chunk = createChatCompletionChunk(id, created, model, text, false);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            if (child.exitCode !== 0) {
              const stderrText = await new Response(child.stderr).text();
              const msg = `cursor-agent failed: ${(stderrText || "").trim()}`;
              const errChunk = createChatCompletionChunk(id, created, model, msg, true);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              return;
            }

            const doneChunk = createChatCompletionChunk(id, created, model, "", true);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } finally {
            closed = true;
            controller.close();
          }
        },
      });

      return new Response(sse, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  const bunAny = globalThis as any;
  if (typeof bunAny.Bun !== "undefined" && typeof bunAny.Bun.serve === "function") {
    // If another process already started a proxy on the default port, reuse it.
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
        fetch: handler,
      });
    };

    try {
      const server = startServer(CURSOR_PROXY_DEFAULT_PORT);
      const baseURL = `http://${CURSOR_PROXY_HOST}:${server.port}/v1`;
      g[key].baseURL = baseURL;
      return baseURL;
    } catch (error: any) {
      const code = error?.code;
      if (code !== "EADDRINUSE") {
        throw error;
      }

      // Something is already bound to the default port. Only reuse it if it looks like our proxy.
      try {
        const res = await fetch(`http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_DEFAULT_PORT}/health`).catch(() => null);
        if (res && res.ok) {
          g[key].baseURL = CURSOR_PROXY_DEFAULT_BASE_URL;
          return CURSOR_PROXY_DEFAULT_BASE_URL;
        }
      } catch {
        // ignore
      }

      // Fallback: start on a random free port.
      const server = startServer(0);
      const baseURL = `http://${CURSOR_PROXY_HOST}:${server.port}/v1`;
      g[key].baseURL = baseURL;
      return baseURL;
    }
  }

  throw new Error("Cursor proxy server requires Bun runtime");
}

/**
 * OpenCode plugin for Cursor Agent
 */
export const CursorPlugin: Plugin = async ({ $, directory }: PluginInput) => {
  const proxyBaseURL = await ensureCursorProxyServer(directory);

  return {
    auth: {
      provider: CURSOR_PROVIDER_ID,
      async loader(_getAuth: () => Promise<Auth>) {
        return {};
      },
      methods: [
        {
          label: "Check cursor-agent availability",
          type: "api",
          authorize: async () => {
            const check = await $`cursor-agent --version`.quiet().nothrow();
            if (check.exitCode !== 0) {
              return { type: "failed" };
            }
            return {
              type: "success",
              key: "cursor-agent",
            };
          },
        },
      ],
    },

    async "chat.params"(input: any, output: any) {
      if (input.model.providerID !== CURSOR_PROVIDER_ID) {
        return;
      }

      // Always point to the actual proxy base URL (may be dynamically allocated).
      output.options = output.options || {};
      output.options.baseURL = proxyBaseURL;
      output.options.apiKey = output.options.apiKey || "cursor-agent";
    },
  };
};

export default CursorPlugin;
