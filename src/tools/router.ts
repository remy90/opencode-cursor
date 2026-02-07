import { createLogger } from "../utils/logger";
import { OpenCodeToolExecutor } from "./executor";
import { toOpenAiParameters, describeTool } from "./schema";
import type { OpenCodeTool } from "./discovery";

const log = createLogger("tools:router");

export interface ToolCallEvent {
  type: "tool_call";
  call_id?: string;
  tool_call_id?: string;
  tool_call?: Record<string, { args?: any }>;
  name?: string;
}

export interface ToolResultChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{ index: number; delta: any; finish_reason: string | null }>;
}

export interface RouterContext {
  executor: OpenCodeToolExecutor;
  toolsByName: Map<string, OpenCodeTool>;
}

export class ToolRouter {
  private ctx: RouterContext;

  constructor(ctx: RouterContext) {
    this.ctx = ctx;
  }

  isOpenCodeTool(name: string | undefined): boolean {
    return !!name && name.startsWith("oc_");
  }

  async handleToolCall(event: ToolCallEvent, meta: { id: string; created: number; model: string }): Promise<ToolResultChunk | null> {
    const callId = event.call_id || event.tool_call_id || "unknown";
    const name = event.name || this.inferName(event);
    if (!this.isOpenCodeTool(name)) return null;

    const tool = this.ctx.toolsByName.get(name);
    if (!tool) {
      return this.buildResult(meta, callId, name, { status: "error", error: `Unknown tool ${name}` });
    }

    const args = this.extractArgs(event);
    const result = await this.ctx.executor.execute(tool.id, args);
    return this.buildResult(meta, callId, name, result);
  }

  private extractArgs(event: ToolCallEvent): any {
    if (event.tool_call) {
      const [key] = Object.keys(event.tool_call);
      return event.tool_call[key]?.args || {};
    }
    // Some agents send args at top-level
    return (event as any).arguments || {};
  }

  private inferName(event: ToolCallEvent): string | undefined {
    if (event.tool_call) {
      const [key] = Object.keys(event.tool_call);
      return key;
    }
    return undefined;
  }

  private buildResult(meta: { id: string; created: number; model: string }, callId: string, name: string, result: { status: string; output?: string; error?: string }): ToolResultChunk {
    const delta: any = {
      role: "assistant",
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name,
            arguments: "{}",
          },
        },
      ],
    };

    // OpenAI tool result convention: include output in a message? We'll place in a synthetic "content" string.
    const content = result.status === "success" ? result.output ?? "" : `Error: ${result.error || "unknown"}`;

    delta.tool_calls[0].function.arguments = JSON.stringify({ result: content }).slice(0, 8000); // guard size

    return {
      id: meta.id,
      object: "chat.completion.chunk",
      created: meta.created,
      model: meta.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: null,
        },
      ],
    };
  }
}
