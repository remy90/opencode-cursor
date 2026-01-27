import type { AcpToolUpdate } from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger("ToolMapper");

interface CursorToolCallEvent {
  type: "tool_call";
  call_id?: string;
  tool_call_id?: string;
  subtype: "started" | "completed";
  tool_call?: Record<string, any>;
}

interface CursorAgentEvent {
  type: string;
  subtype?: string;
  call_id?: string;
  tool_call_id?: string;
  tool_call?: Record<string, any>;
}

export class ToolMapper {
  async mapCursorEventToAcp(
    evt: CursorAgentEvent,
    sessionId: string
  ): Promise<AcpToolUpdate[]> {
    switch (evt.type) {
      case "tool_call":
        return this.handleToolCall(evt as CursorToolCallEvent, sessionId);
      default:
        return [];
    }
  }

  private async handleToolCall(
    evt: CursorToolCallEvent,
    sessionId: string
  ): Promise<AcpToolUpdate[]> {
    const updates: AcpToolUpdate[] = [];
    const callId = evt.call_id || evt.tool_call_id || "";
    const toolKind = this.getToolKind(evt.tool_call);
    const args = toolKind ? evt.tool_call?.[toolKind]?.args || {} : {};

    if (evt.subtype === "started") {
      const update: AcpToolUpdate = {
        sessionId,
        toolCallId: callId,
        title: this.buildToolTitle(toolKind || "other", args),
        kind: this.inferToolType(toolKind || "other"),
        status: "pending",
        locations: this.extractLocations(args),
        rawInput: JSON.stringify(args),
        startTime: Date.now()
      };

      updates.push(update);

      updates.push({
        sessionId,
        toolCallId: callId,
        status: "in_progress"
      });
    } else if (evt.subtype === "completed") {
      const result = toolKind ? evt.tool_call?.[toolKind]?.result : undefined;
      const update = await this.buildCompletionUpdate(callId, toolKind || "other", args, result);
      updates.push(update);
    }

    return updates;
  }

  private getToolKind(toolCall: Record<string, any> | undefined): string | undefined {
    if (!toolCall) return undefined;
    return Object.keys(toolCall)[0];
  }

  private buildToolTitle(kind: string, args: any): string {
    switch (kind) {
      case "readToolCall":
        return args?.path ? `Read ${args.path}` : "Read";
      case "writeToolCall":
        return args?.path ? `Write ${args.path}` : "Write";
      case "grepToolCall":
        if (args?.pattern && args?.path) return `Search ${args.path} for ${args.pattern}`;
        if (args?.pattern) return `Search for ${args.pattern}`;
        return "Search";
      case "globToolCall":
        return args?.pattern ? `Glob ${args.pattern}` : "Glob";
      case "bashToolCall":
      case "shellToolCall":
        const cmd = args?.command ?? args?.cmd ?? (Array.isArray(args?.commands) ? args.commands.join(" && ") : undefined);
        return cmd ? `\`${cmd}\`` : "Terminal";
      default:
        return kind;
    }
  }

  private inferToolType(kind: string): "read" | "edit" | "search" | "execute" | "other" {
    switch (kind) {
      case "readToolCall":
        return "read";
      case "writeToolCall":
        return "edit";
      case "grepToolCall":
      case "globToolCall":
        return "search";
      case "bashToolCall":
      case "shellToolCall":
        return "execute";
      default:
        return "other";
    }
  }

  private extractLocations(args: any): Array<{ path: string; line?: number }> | undefined {
    const locs: Array<{ path: string; line?: number }> = [];

    if (typeof args?.path === "string") {
      locs.push({ path: String(args.path), line: typeof args.line === "number" ? args.line : undefined });
    }

    if (Array.isArray(args?.paths)) {
      for (const p of args.paths) {
        if (typeof p === "string") locs.push({ path: p });
        else if (p && typeof p.path === "string") {
          locs.push({ path: p.path, line: typeof p.line === "number" ? p.line : undefined });
        }
      }
    }

    return locs.length > 0 ? locs : undefined;
  }

  private async buildCompletionUpdate(
    callId: string,
    toolKind: string,
    args: any,
    result: any
  ): Promise<AcpToolUpdate> {
    const update: AcpToolUpdate = {
      sessionId: "",
      toolCallId: callId,
      status: result?.error ? "failed" : "completed",
      rawOutput: result ? JSON.stringify(result) : "",
      endTime: Date.now()
    };

    const locations = this.extractResultLocations(result);
    if (locations) update.locations = locations;

    if (toolKind === "writeToolCall") {
      const contentText = result?.newText ?? args?.fileText ?? "";
      update.content = [{
        type: "diff",
        path: args.path || "",
        oldText: result?.oldText || null,
        newText: contentText
      } as any];
    } else if (toolKind === "bashToolCall" || toolKind === "shellToolCall") {
      const output = result?.output ?? "";
      const exitCode = typeof result?.exitCode === "number" ? result.exitCode : undefined;
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

  private extractResultLocations(result: any): Array<{ path: string; line?: number }> | undefined {
    if (!result) return undefined;

    const locs: Array<{ path: string; line?: number }> = [];

    if (Array.isArray(result?.matches)) {
      for (const m of result.matches) {
        if (typeof m === "string") locs.push({ path: m });
        else if (m && typeof m.path === "string") {
          locs.push({ path: m.path, line: typeof m.line === "number" ? m.line : undefined });
        }
      }
    }

    if (Array.isArray(result?.files)) {
      for (const f of result.files) {
        if (typeof f === "string") locs.push({ path: f });
        else if (f && typeof f.path === "string") {
          locs.push({ path: f.path, line: typeof f.line === "number" ? f.line : undefined });
        }
      }
    }

    if (typeof result?.path === "string") {
      locs.push({ path: result.path, line: typeof result.line === "number" ? result.line : undefined });
    }

    return locs.length > 0 ? locs : undefined;
  }
}
