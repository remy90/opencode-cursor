
/**
 * Cursor Provider for OpenCode using AI SDK
 *
 * Minimal working implementation using @ai-sdk/provider
 */

import { customProvider } from "ai";
import { SimpleCursorClient } from "./client/simple.js";

/**
 * Simple language model wrapper for cursor-agent
 * Converts cursor-agent's stdin/stdout to AI SDK LanguageModel interface
 */
class CursorLanguageModel {
  constructor(
    private modelId: string,
    private client: SimpleCursorClient
  ) {
    this.modelId = modelId;
    this.client = client;
  }

  async generateText({ prompt, ...options }: any): Promise<{
    text: string;
    usage?: { promptTokens: number; completionTokens: number };
    finishReason: "stop" | "length" | "content-filter" | "error";
    warnings?: string[];
  }> {
    const result = await this.client.executePrompt(prompt, {
      model: this.modelId,
      ...options
    });

    return {
      text: result.content || result.error || "No response",
      finishReason: result.done ? "stop" : "error",
      warnings: result.error ? [result.error] : undefined,
    };
  }

  async *streamText({ prompt, ...options }: any): AsyncGenerator<{
    type: "text-delta";
    textDelta?: string;
    finishReason: "stop" | "length" | "content-filter" | "error";
  }> {
    const stream = this.client.executePromptStream(prompt, {
      model: this.modelId,
      ...options
    });

    for await (const line of stream) {
      try {
        const evt = JSON.parse(line);

        if (evt.type === "assistant" && evt.message?.content?.[0]?.text) {
          yield {
            type: "text-delta",
            textDelta: evt.message.content[0].text,
            finishReason: "stop",
          };
        }
      } catch {
      }
    }

    yield {
      type: "text-delta",
      finishReason: "stop",
    };
  }
}

const cursorProvider = customProvider({
  id: "cursor-acp",

  languageModels: {
    "cursor-acp/auto": new CursorLanguageModel("cursor-acp/auto"),

    "cursor-acp/gpt-5.1": new CursorLanguageModel("cursor-acp/gpt-5.1"),
    "cursor-acp/gpt-5.2": new CursorLanguageModel("cursor-acp/gpt-5.2"),
    "cursor-acp/gpt-5.1-codex": new CursorLanguageModel("cursor-acp/gpt-5.1-codex"),
    "cursor-acp/gpt-5.1-high": new CursorLanguageModel("cursor-acp/gpt-5.1-high"),
    "cursor-acp/gpt-5.1-mini": new CursorLanguageModel("cursor-acp/gpt-5.1-mini"),

    "cursor-acp/claude-4.5-sonnet": new CursorLanguageModel("cursor-acp/claude-4.5-sonnet"),
    "cursor-acp/claude-4.5-sonnet-thinking": new CursorLanguageModel("cursor-acp/claude-4.5-sonnet-thinking"),
    "cursor-acp/claude-4.5-opus": new CursorLanguageModel("cursor-acp/claude-4.5-opus"),
    "cursor-acp/claude-4.5-haiku": new CursorLanguageModel("cursor-acp/claude-4.5-haiku"),

    "cursor-acp/gemini-3-flash": new CursorLanguageModel("cursor-acp/gemini-3-flash"),
    "cursor-acp/gemini-3-pro": new CursorLanguageModel("cursor-acp/gemini-3-pro"),

    "cursor-acp/deepseek-v3.2": new CursorLanguageModel("cursor-acp/deepseek-v3.2"),

    "cursor-acp/kimi-k2": new CursorLanguageModel("cursor-acp/kimi-k2"),

    "cursor-acp/grok-4": new CursorLanguageModel("cursor-acp/grok-4"),
    "cursor-acp/grok-4-code": new CursorLanguageModel("cursor-acp/grok-4-code"),

    // And more models...
  },

  generateText: async ({ prompt, modelId, ...options }) => {
    const model = new CursorLanguageModel(modelId);
    return await model.generateText({ prompt, ...options });
  },

  streamText: async ({ prompt, modelId, ...options }) => {
    const model = new CursorLanguageModel(modelId);
    return model.streamText({ prompt, ...options });
  },
});

export default cursorProvider;
