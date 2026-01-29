import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createProxyServer } from "../../src/proxy/server.js";
import { ToolRegistry, ToolExecutor } from "../../src/tools/index.js";
import { registerDefaultTools, getDefaultToolNames } from "../../src/tools/defaults.js";
import { ModelDiscoveryService, ConfigUpdater } from "../../src/models/index.js";
import { createCursorProvider } from "../../src/provider.js";

describe("Comprehensive End-to-End Integration", () => {
  describe("Full Provider Flow", () => {
    it("should create provider in proxy mode and execute model", async () => {
      const provider = createCursorProvider({
        mode: 'proxy',
        proxyConfig: { port: 32132 }
      });

      await provider.init();

      expect(provider.id).toBe("cursor-acp");
      expect(provider.baseURL).toContain("32132");

      // Get language model
      const model = provider.languageModel("cursor-acp/auto");
      expect(model.modelId).toBe("cursor-acp/auto");
      expect(model.provider).toBe("cursor-acp");

      // Cleanup
      await provider.proxy.stop();
    });

    it("should create provider in direct mode", async () => {
      const provider = createCursorProvider({
        mode: 'direct'
      });

      expect(provider.id).toBe("cursor-acp");
      expect(provider.name).toBe("Cursor ACP Provider");

      // Get language model
      const model = provider.languageModel("cursor-acp/gpt-5.2");
      expect(model.modelId).toBe("cursor-acp/gpt-5.2");
    });
  });

  describe("Proxy + Tools Integration", () => {
    let server: any;
    let baseURL: string;

    beforeAll(async () => {
      server = createProxyServer({ port: 32133 });
      baseURL = await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it("should have working health endpoint", async () => {
      const response = await fetch(`${baseURL.replace('/v1', '')}/health`);
      expect(response.status).toBe(200);
    });

    it("should integrate tool registry with defaults", () => {
      const registry = new ToolRegistry();
      registerDefaultTools(registry);

      expect(registry.getAllDefinitions().length).toBe(7);
      expect(registry.has("bash")).toBe(true);
      expect(registry.has("read")).toBe(true);
      expect(registry.has("write")).toBe(true);
      expect(registry.has("edit")).toBe(true);
      expect(registry.has("grep")).toBe(true);
      expect(registry.has("ls")).toBe(true);
      expect(registry.has("glob")).toBe(true);
    });
  });

  describe("Model Discovery + Config Integration", () => {
    it("should discover models and generate config", async () => {
      const service = new ModelDiscoveryService();
      const updater = new ConfigUpdater();

      const models = await service.discover();
      expect(models.length).toBeGreaterThan(0);

      const config = updater.generateProviderConfig(models, "http://localhost:32124/v1");

      expect(config.npm).toBeDefined();
      expect(config.name).toBeDefined();
      expect(config.options.baseURL).toBe("http://localhost:32124/v1");
      expect(Object.keys(config.models).length).toBeGreaterThan(0);

      // Each model should have tools and reasoning enabled
      for (const key of Object.keys(config.models)) {
        expect(config.models[key].tools).toBe(true);
        expect(config.models[key].reasoning).toBe(true);
      }
    });

    it("should cache models", async () => {
      const service = new ModelDiscoveryService({ cacheTTL: 60000 });

      const models1 = await service.discover();
      const models2 = await service.discover();

      expect(models1).toEqual(models2);
    });

    it("should format models correctly", () => {
      const updater = new ConfigUpdater();

      const models = [
        { id: "gpt-5.2", name: "GPT 5.2" },
        { id: "sonnet-4.5", name: "Sonnet 4.5" }
      ];

      const formatted = updater.formatModels(models);

      // IDs with dots should be normalized
      expect(formatted.gpt52).toBeDefined();
      expect(formatted.sonnet45).toBeDefined();
      expect(formatted.gpt52.name).toBe("GPT 5.2");
    });
  });

  describe("Tool Execution with Real Files", () => {
    it("should execute full file workflow", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const registry = new ToolRegistry();
      registerDefaultTools(registry);
      const executor = new ToolExecutor(registry);

      const testDir = `/tmp/e2e-test-${Date.now()}`;
      const testFile = path.join(testDir, "test.txt");

      // Create directory
      fs.mkdirSync(testDir, { recursive: true });

      // Write file
      await executor.execute("write", {
        path: testFile,
        content: "Line 1\nLine 2\nLine 3"
      });

      // Read file
      const readResult = await executor.execute("read", { path: testFile });
      expect(readResult).toBe("Line 1\nLine 2\nLine 3");

      // Edit file
      await executor.execute("edit", {
        path: testFile,
        old_string: "Line 2",
        new_string: "Modified Line"
      });

      // Read again
      const editedResult = await executor.execute("read", { path: testFile });
      expect(editedResult).toBe("Line 1\nModified Line\nLine 3");

      // List directory
      const lsResult = await executor.execute("ls", { path: testDir });
      expect(lsResult).toContain("test.txt");

      // Grep for content
      const grepResult = await executor.execute("grep", {
        pattern: "Modified",
        path: testDir
      });
      expect(grepResult).toContain("Modified Line");

      // Cleanup
      fs.unlinkSync(testFile);
      fs.rmdirSync(testDir);
    });
  });

  describe("Performance Benchmarks", () => {
    it("should start proxy server quickly", async () => {
      const startTime = Date.now();
      const server = createProxyServer({ port: 32134 });
      await server.start();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(500); // Should start in <500ms
      await server.stop();
    });

    it("should handle multiple concurrent tool executions", async () => {
      const registry = new ToolRegistry();
      registerDefaultTools(registry);
      const executor = new ToolExecutor(registry);

      const startTime = Date.now();

      // Execute 10 tool calls concurrently
      const promises = Array(10).fill(null).map((_, i) =>
        executor.execute("bash", { command: `echo "test-${i}"` })
      );

      const results = await Promise.all(promises);

      const endTime = Date.now();

      expect(results.length).toBe(10);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete in <2s

      // Verify all results
      for (let i = 0; i < 10; i++) {
        expect(results[i]).toContain(`test-${i}`);
      }
    });

    it("should cache model discovery", async () => {
      const service = new ModelDiscoveryService({ cacheTTL: 5000 });

      const startTime1 = Date.now();
      await service.discover();
      const endTime1 = Date.now();

      const startTime2 = Date.now();
      await service.discover(); // Should be cached
      const endTime2 = Date.now();

      // Second call should be much faster (cached)
      expect(endTime2 - startTime2).toBeLessThan(endTime1 - startTime1);
    });
  });

  describe("Error Handling", () => {
    it("should handle proxy server errors gracefully", async () => {
      const server = createProxyServer({ port: 32135 });
      await server.start();

      // Try to start another server on same port
      const server2 = createProxyServer({ port: 32135 });

      // Should handle gracefully (either fail or succeed)
      try {
        await server2.start();
        await server2.stop();
      } catch (e) {
        // Expected to possibly fail
      }

      await server.stop();
    });

    it("should handle tool execution errors", async () => {
      const registry = new ToolRegistry();
      registerDefaultTools(registry);
      const executor = new ToolExecutor(registry);

      // Non-existent file
      const result = await executor.execute("read", {
        path: "/non/existent/file.txt"
      });

      expect(result).toContain("Error");
    });

    it("should handle invalid tool calls", async () => {
      const registry = new ToolRegistry();
      const executor = new ToolExecutor(registry);

      let errorThrown = false;
      try {
        await executor.execute("non-existent-tool", {});
      } catch (e) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
    });
  });

  describe("Feature Completeness", () => {
    it("should have all required proxy features", () => {
      const server = createProxyServer({
        port: 32136,
        host: "127.0.0.1",
        healthCheckPath: "/health"
      });

      expect(server.start).toBeDefined();
      expect(server.stop).toBeDefined();
      expect(server.getBaseURL).toBeDefined();
    });

    it("should have all required tool features", () => {
      const registry = new ToolRegistry();
      registerDefaultTools(registry);

      // All 7 tools should be registered
      const toolNames = getDefaultToolNames();
      expect(toolNames.length).toBe(7);

      for (const name of toolNames) {
        const tool = registry.get(name);
        expect(tool).toBeDefined();
        expect(tool?.definition.function.name).toBe(name);
        expect(tool?.definition.function.description).toBeDefined();
        expect(tool?.definition.function.parameters).toBeDefined();
      }
    });

    it("should have all required model discovery features", async () => {
      const service = new ModelDiscoveryService();

      expect(service.discover).toBeDefined();
      expect(service.invalidateCache).toBeDefined();

      const models = await service.discover();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      // Each model should have required fields
      for (const model of models) {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
      }
    });
  });
});