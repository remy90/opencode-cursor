import { describe, it, expect } from "bun:test";
import { ToolRegistry } from "../../src/tools/registry.js";
import { registerDefaultTools, getDefaultToolNames } from "../../src/tools/defaults.js";
import { ToolExecutor } from "../../src/tools/executor.js";

describe("Default Tools", () => {
  it("should register all 7 default tools", () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const toolNames = getDefaultToolNames();
    expect(toolNames).toHaveLength(7);

    for (const name of toolNames) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it("should have correct tool definitions", () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const bash = registry.get("bash");
    expect(bash?.definition.function.name).toBe("bash");
    expect(bash?.definition.function.parameters.required).toContain("command");

    const read = registry.get("read");
    expect(read?.definition.function.name).toBe("read");
    expect(read?.definition.function.parameters.required).toContain("path");

    const write = registry.get("write");
    expect(write?.definition.function.name).toBe("write");

    const edit = registry.get("edit");
    expect(edit?.definition.function.name).toBe("edit");

    const grep = registry.get("grep");
    expect(grep?.definition.function.name).toBe("grep");

    const ls = registry.get("ls");
    expect(ls?.definition.function.name).toBe("ls");

    const glob = registry.get("glob");
    expect(glob?.definition.function.name).toBe("glob");
  });

  it("should execute ls tool", async () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);
    const executor = new ToolExecutor(registry);

    const result = await executor.execute("ls", { path: "." });

    // Should list current directory contents
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should execute read tool", async () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);
    const executor = new ToolExecutor(registry);

    // Create a temp file to read
    const fs = await import("fs");
    const tmpFile = `/tmp/test-read-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, "Hello, World!", "utf-8");

    const result = await executor.execute("read", { path: tmpFile });

    expect(result).toBe("Hello, World!");

    // Cleanup
    fs.unlinkSync(tmpFile);
  });

  it("should execute write and read tools together", async () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);
    const executor = new ToolExecutor(registry);

    const tmpFile = `/tmp/test-write-${Date.now()}.txt`;

    // Write
    const writeResult = await executor.execute("write", {
      path: tmpFile,
      content: "Test content"
    });
    expect(writeResult).toContain("written successfully");

    // Read back
    const readResult = await executor.execute("read", { path: tmpFile });
    expect(readResult).toBe("Test content");

    // Cleanup
    const fs = await import("fs");
    fs.unlinkSync(tmpFile);
  });

  it("should execute edit tool", async () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);
    const executor = new ToolExecutor(registry);

    const fs = await import("fs");
    const tmpFile = `/tmp/test-edit-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, "Hello, World!", "utf-8");

    const result = await executor.execute("edit", {
      path: tmpFile,
      old_string: "World",
      new_string: "Universe"
    });

    expect(result).toContain("edited successfully");

    const content = fs.readFileSync(tmpFile, "utf-8");
    expect(content).toBe("Hello, Universe!");

    // Cleanup
    fs.unlinkSync(tmpFile);
  });

  it("should get all tool definitions", () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const definitions = registry.getAllDefinitions();
    expect(definitions).toHaveLength(7);

    // All should be function types
    for (const def of definitions) {
      expect(def.type).toBe("function");
      expect(def.function.name).toBeDefined();
      expect(def.function.description).toBeDefined();
    }
  });
});