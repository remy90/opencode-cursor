import { z } from 'zod';
import { logger } from '../utils/logger.js';

const log = logger('config-validator', 'info');

export const CursorConfigSchema = z.object({
  timeout: z.number().int().positive().default(30000),
  maxRetries: z.number().int().min(0).max(10).default(3),
  streamOutput: z.boolean().default(true),
  logLevel: z.enum(['none', 'error', 'warn', 'info', 'debug']).default('info'),
  backupRetention: z.number().int().min(0).default(7),
  cursorAgentPath: z.string().default('cursor-agent')
});

export type CursorConfig = z.infer<typeof CursorConfigSchema>;

export interface OpenCodePluginConfig {
  provider?: {
    'cursor-acp'?: {
      npm?: string;
      name?: string;
      options?: {
        baseURL?: string;
      };
      models?: Record<string, unknown>;
    };
  };
}

export interface ValidationResult {
  valid: boolean;
  config?: CursorConfig;
  errors?: string[];
}

export function validateCursorConfig(config: unknown): CursorConfig {
  try {
    const result = CursorConfigSchema.parse(config);
    log.debug('Configuration validated successfully');
    return result;
  } catch (error) {
    if (error instanceof Error && 'errors' in error) {
      const errorDetails = JSON.stringify(error);
      log.error('Configuration validation failed', { error: errorDetails });
      throw new Error(`Invalid configuration: ${error?.toString() || 'Unknown error'}`);
    }
    throw new Error(`Invalid configuration: ${error}`);
  }
}

export function validateOpenCodeConfig(config: OpenCodePluginConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.provider?.['cursor-acp']) {
    errors.push('cursor-acp provider configuration not found');
  }

  if (config.provider?.['cursor-acp']?.npm !== '@ai-sdk/openai-compatible') {
    errors.push('cursor-acp provider must use @ai-sdk/openai-compatible npm package');
  }

  if (!config.provider?.['cursor-acp']?.options?.baseURL) {
    errors.push('cursor-acp provider must have baseURL option configured');
  }

  if (!config.provider?.['cursor-acp']?.models) {
    errors.push('cursor-acp provider must have models section configured');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

export function mergeConfigDefaults(
  userConfig: Partial<CursorConfig>,
  defaults: CursorConfig = CursorConfigSchema.parse({})
): CursorConfig {
  const merged = { ...defaults, ...userConfig };
  return validateCursorConfig(merged);
}