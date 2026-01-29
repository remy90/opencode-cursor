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
