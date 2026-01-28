import { customProvider } from "@ai-sdk/openai-compatible";
import { SimpleCursorClient } from "./client/simple.js";

export const cursorProvider = customProvider({
  id: "cursor-acp",
  languageModels: {
    "cursor-acp/auto": {
      async generateText({ prompt }) {
        const result = await new SimpleCursorClient().executePrompt(prompt);
        return {
          text: result.content || result.error || "No response",
          finishReason: result.done ? "stop" : "error"
        };
      },
      async *streamText({ prompt }) {
        const stream = new SimpleCursorClient().executePromptStream(prompt);
        for await (const line of stream) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === "assistant" && evt.message?.content?.[0]?.text) {
              yield {
                type: "text-delta",
                textDelta: evt.message.content[0].text,
                finishReason: "stop"
              };
            }
          } catch {}
        }
        yield { type: "text-delta", finishReason: "stop" };
      }
    }
  }
});

export default cursorProvider;
