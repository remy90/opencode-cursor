import type { Plugin, Hooks, LanguageModelV1 } from "@opencode-ai/plugin";
import { createSimpleCursorClient } from "../client/simple.js";
import { logger } from "../utils/logger.js";
import { validateCursorConfig } from "../config/validator.js";

export interface CursorProviderConfig {
  timeout?: number;
  maxRetries?: number;
  streamOutput?: boolean;
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  backupRetention?: number;
}

const CURSOR_MODELS = {
  'auto': 'Cursor Agent Auto',
  'composer-1': 'Cursor Agent Composer 1',
  'deepseek-v3.2': 'Cursor Agent DeepSeek V3.2',
  'gemini-3-flash': 'Cursor Agent Gemini 3 Flash',
  'gemini-3-pro': 'Cursor Agent Gemini 3 Pro',
  'gemini-3-pro-preview': 'Cursor Agent Gemini 3 Pro Preview',
  'gpt-5': 'Cursor Agent GPT-5 (alias → gpt-5.2)',
  'gpt-5-mini': 'Cursor Agent GPT-5 Mini',
  'gpt-5-pro': 'Cursor Agent GPT-5 Pro',
  'gpt-5.1': 'Cursor Agent GPT-5.1',
  'gpt-5.1-codex': 'Cursor Agent GPT-5.1 Codex',
  'gpt-5.1-codex-max-xhigh': 'Cursor Agent GPT-5.1 Codex Max XHigh',
  'gpt-5.1-codex-mini-high': 'Cursor Agent GPT-5.1 Codex Mini High',
  'gpt-5.1-high': 'Cursor Agent GPT-5.1 High',
  'gpt-5.2': 'Cursor Agent GPT-5.2',
  'gpt-5.2-codex': 'Cursor Agent GPT-5.2 Codex',
  'gpt-5.2-high': 'Cursor Agent GPT-5.2 High',
  'gpt-5.2-xhigh': 'Cursor Agent GPT-5.2 XHigh',
  'grok-4': 'Cursor Agent Grok 4',
  'grok-4-fast': 'Cursor Agent Grok 4 Fast',
  'grok-code': 'Cursor Agent Grok Code',
  'grok-code-fast': 'Cursor Agent Grok Code Fast',
  'haiku-4.5': 'Cursor Agent Claude 4.5 Haiku',
  'kimi-k2': 'Cursor Agent Kimi K2',
  'opus-4.5': 'Cursor Agent Claude 4.5 Opus',
  'opus-4.5-thinking': 'Cursor Agent Claude 4.5 Opus Thinking',
  'sonnet-4.5': 'Cursor Agent Claude 4.5 Sonnet',
  'sonnet-4.5-thinking': 'Cursor Agent Claude 4.5 Sonnet Thinking'
};

const createCursorLanguageModel = (modelId: string, config: CursorProviderConfig): LanguageModelV1 => {
  const log = logger(`cursor-model:${modelId}`, config.logLevel || 'info');
  const client = createSimpleCursorClient({
    timeout: config.timeout,
    maxRetries: config.maxRetries,
    streamOutput: config.streamOutput
  });

  return {
    modelId,
    specification: {
      supports: {
        toolCall: false,
        multipleTools: false,
        imageInput: false
      }
    },
    
    async doGenerate(request, { abortSignal }) {
      log.info('Generating response', { promptLength: request.prompt?.length || 0 });
      
      try {
        const model = modelId === 'auto' ? 'auto' : modelId;
        const response = await client.executePrompt(request.prompt ?? '', {
          model,
          mode: 'default',
          cwd: process.cwd()
        });

        const usage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        };

        return {
          finishReason: 'stop',
          text: response.content,
          usage
        };
      } catch (error) {
        log.error('Generation failed', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    async *doStream(request, { abortSignal }) {
      log.info('Streaming response', { promptLength: request.prompt?.length || 0 });
      
      const model = modelId === 'auto' ? 'auto' : modelId;
      const stream = client.executePromptStream(request.prompt ?? '', {
        model,
        mode: 'default',
        cwd: process.cwd()
      });

      for await (const line of stream) {
        if (abortSignal?.aborted) {
          log.info('Stream aborted');
          break;
        }

        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message?.content?.[0]?.text) {
            const text = event.message.content[0].text;
            yield {
              type: 'text-delta' as const,
              textDelta: text
            };
          }
        } catch (error) {
          log.debug('Skipping non-JSON line', { line });
        }
      }

      yield {
        type: 'finish' as const,
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      };
    }
  };
};

export class CursorProvider {
  private config: CursorProviderConfig;

  constructor(config: CursorProviderConfig = {}) {
    this.config = {
      timeout: 30000,
      maxRetries: 3,
      streamOutput: true,
      logLevel: 'info',
      backupRetention: 7,
      ...config
    };
  }

  async getHooks(): Promise<Hooks> {
    const log = logger('cursor-provider', this.config.logLevel);

    const languageModels: Record<string, LanguageModelV1> = {};
    
    for (const [modelId, modelName] of Object.entries(CURSOR_MODELS)) {
      const fullModelId = `cursor-acp/${modelId}`;
      languageModels[fullModelId] = createCursorLanguageModel(modelId, this.config);
    }

    return {
      config: async (config) => {
        try {
          log.debug('Config hook called');
          validateCursorConfig(config);
        } catch (error) {
          log.error('Config hook error:', error);
          throw error;
        }
      },
      auth: {
        provider: "cursor-acp",
        loader: async (getAuth, provider) => {
          try {
            log.debug('Auth loader called for provider:', provider);

            return {
              apiKey: "cursor-acp-no-auth-required",
              baseURL: "http://127.0.0.1:32123/v1"
            };
          } catch (error) {
            log.error('Auth loader error:', error);
            return {
              apiKey: "",
              baseURL: "http://127.0.0.1:32123/v1"
            };
          }
        },
        methods: [{
          type: "api",
          label: "Cursor Agent ACP through stdin/stdout"
        }]
      },
      languageModels
    };
  }

  async shutdown(): Promise<void> {
    logger('cursor-provider', this.config.logLevel).info('Provider shutting down');
  }
}

export const createCursorProvider = (config: CursorProviderConfig = {}) => {
  return new CursorProvider(config);
};