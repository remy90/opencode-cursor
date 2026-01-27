export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, error?: unknown) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  'none': 0,
  'error': 1,
  'warn': 2,
  'info': 3,
  'debug': 4
};

export function logger(module: string, level: LogLevel = 'info'): Logger {
  const currentLevel = LOG_LEVELS[level];

  const log = (prefix: string, message: string, meta?: unknown) => {
    const formatted = JSON.stringify({ module, message, ...(meta ? { meta } : {}) }, null, 0);
    console[prefix === 'error' || prefix === 'warn' ? prefix : 'error'](`${prefix.toUpperCase()} [cursor:${module}] ${formatted}`);
  };

  return {
    debug: (message: string, meta?: unknown) => {
      if (currentLevel >= LOG_LEVELS.debug) log('debug', message, meta);
    },
    info: (message: string, meta?: unknown) => {
      if (currentLevel >= LOG_LEVELS.info) log('info', message, meta);
    },
    warn: (message: string, meta?: unknown) => {
      if (currentLevel >= LOG_LEVELS.warn) log('warn', message, meta);
    },
    error: (message: string, error?: unknown) => {
      if (currentLevel >= LOG_LEVELS.error) log('error', message, error || undefined);
    }
  };
}