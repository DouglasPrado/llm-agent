import type { LogLevel } from '../contracts/enums/index.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface Logger {
  level: LogLevel;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

function formatMessage(level: string, prefix: string | undefined, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const prefixStr = prefix ? `[${prefix}] ` : '';
  const contextStr = context ? ' ' + JSON.stringify(context) : '';
  return `${timestamp} ${level.toUpperCase()} ${prefixStr}${message}${contextStr}`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const prefix = options.prefix;
  const threshold = LOG_LEVELS[level];

  function shouldLog(msgLevel: LogLevel): boolean {
    return LOG_LEVELS[msgLevel] >= threshold;
  }

  const logger: Logger = {
    level,
    debug(message, context?) {
      if (shouldLog('debug')) console.debug(formatMessage('debug', prefix, message, context));
    },
    info(message, context?) {
      if (shouldLog('info')) console.info(formatMessage('info', prefix, message, context));
    },
    warn(message, context?) {
      if (shouldLog('warn')) console.warn(formatMessage('warn', prefix, message, context));
    },
    error(message, context?) {
      if (shouldLog('error')) console.error(formatMessage('error', prefix, message, context));
    },
    child(childPrefix: string): Logger {
      const newPrefix = prefix ? `${prefix}:${childPrefix}` : childPrefix;
      return createLogger({ level, prefix: newPrefix });
    },
  };

  return logger;
}
