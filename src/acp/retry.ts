import type { RetryContext } from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger("RetryEngine");

export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class RetryEngine {
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;

  constructor(config: RetryConfig = {}) {
    this.maxRetries = config.maxRetries || 3;
    this.baseDelayMs = config.baseDelayMs || 1000;
    this.maxDelayMs = config.maxDelayMs || 30000;
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: RetryContext
  ): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetries) {
      try {
        const result = await operation();
        log.info(`Success on attempt ${attempt + 1}`, { context });
        return result;
      } catch (error) {
        lastError = error as Error;

        if (!this.isRecoverable(error as Error, context)) {
          log.error(`Fatal error, not retrying`, { error, context });
          throw error;
        }

        attempt++;
        const delay = this.calculateBackoff(attempt);
        log.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, { error });
        await this.sleep(delay);
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded`, { cause: lastError });
  }

  private isRecoverable(error: Error, context: RetryContext): boolean {
    const msg = error.message || "";

    // Recoverable: timeout, network, rate limit
    if (msg.includes("timeout")) return true;
    if (msg.includes("ECONNREFUSED")) return true;
    if (msg.includes("ETIMEDOUT")) return true;
    if (msg.includes("429")) return true;
    if (msg.includes("rate limit")) return true;

    // Fatal: auth error, invalid config
    if (msg.includes("Not logged in")) return false;
    if (msg.includes("Not authenticated")) return false;
    if (msg.includes("invalid model")) return false;
    if (msg.includes("Invalid configuration")) return false;

    return false;
  }

  private calculateBackoff(attempt: number): number {
    const delay = this.baseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(delay, this.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
