import { createLogger } from "../utils/logger";
import stripAnsi from "strip-ansi";

const log = createLogger("tools:executor");

export interface ToolExecuteResult {
  status: "success" | "error";
  output?: string;
  error?: string;
}

export interface ExecutorOptions {
  timeoutMs?: number;
  mode?: "sdk" | "cli" | "auto";
}

export class OpenCodeToolExecutor {
  private client: any;
  private timeout: number;
  private mode: "sdk" | "cli" | "auto";

  constructor(client: any, opts: ExecutorOptions = {}) {
    this.client = client;
    this.timeout = opts.timeoutMs ?? Number(process.env.CURSOR_ACP_TOOL_TIMEOUT_MS || 30000);
    this.mode = opts.mode ?? (process.env.CURSOR_ACP_TOOL_EXECUTOR as any) ?? "auto";
  }

  async execute(toolId: string, args: any): Promise<ToolExecuteResult> {
    // SDK path first (unless forced CLI)
    if (this.mode !== "cli") {
      try {
        if (this.client?.tool?.invoke) {
          const res = await this.runWithTimeout(this.client.tool.invoke(toolId, args));
          const out = typeof res === "string" ? res : JSON.stringify(res);
          return { status: "success", output: out };
        }
      } catch (err) {
        log.warn("SDK invoke failed, will try CLI", { error: String(err) });
        if (this.mode === "sdk") {
          return { status: "error", error: String(err) };
        }
      }
    }

    // CLI fallback
    if (this.mode !== "sdk") {
      try {
        const { spawn } = await import("node:child_process");
        const child = spawn("opencode", ["tool", "run", toolId, "--json", JSON.stringify(args)], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const exited = new Promise<{ code: number | null }>((resolve) => {
          child.on("close", (code) => resolve({ code }));
        });

        const stdout = new Promise<string>((resolve) => {
          child.stdout?.on("data", (c) => stdoutChunks.push(Buffer.from(c)));
          child.stdout?.on("end", () => resolve(Buffer.concat(stdoutChunks).toString("utf-8")));
        });

        const stderr = new Promise<string>((resolve) => {
          child.stderr?.on("data", (c) => stderrChunks.push(Buffer.from(c)));
          child.stderr?.on("end", () => resolve(Buffer.concat(stderrChunks).toString("utf-8")));
        });

        const { code } = await this.runWithTimeout(exited);
        const out = await stdout;
        const err = await stderr;

        if (code === 0) {
          const clean = stripAnsi(out || "");
          return { status: "success", output: clean || "(no output)" };
        }
        return { status: "error", error: stripAnsi(err || out || `Exit code ${code}`) };
      } catch (err) {
        return { status: "error", error: String(err) };
      }
    }

    return { status: "error", error: "No executor available" };
  }

  private async runWithTimeout<T>(p: Promise<T>): Promise<T> {
    const to = this.timeout;
    if (!to) return p;
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("tool execution timeout")), to)),
    ]);
  }
}
