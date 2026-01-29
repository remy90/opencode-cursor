import type { ProxyConfig, ProxyServer } from "./types.js";

export function createProxyServer(config: ProxyConfig): ProxyServer {
  const port = config.port ?? 32123;
  const host = config.host ?? "127.0.0.1";
  const healthCheckPath = config.healthCheckPath ?? "/health";

  let server: ReturnType<typeof Bun.serve> | null = null;
  const baseURL = `http://${host}:${port}/v1`;

  return {
    start(): Promise<string> {
      if (server) {
        return Promise.resolve(baseURL);
      }

      server = Bun.serve({
        port,
        hostname: host,
        fetch(request: Request): Response | Promise<Response> {
          const url = new URL(request.url);
          const path = url.pathname;

          // Health check endpoint
          if (path === healthCheckPath && request.method === "GET") {
            return Response.json({ ok: true });
          }

          // Return 404 for all other paths
          return new Response("Not Found", { status: 404 });
        },
      });

      return Promise.resolve(baseURL);
    },

    stop(): Promise<void> {
      if (!server) {
        return Promise.resolve();
      }

      server.stop(true);
      server = null;
      return Promise.resolve();
    },

    getBaseURL(): string {
      return baseURL;
    },
  };
}
