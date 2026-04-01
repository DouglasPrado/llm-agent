import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, type Logger } from '../../../src/utils/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a logger with default level info', () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });

  it('should respect log level filtering', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const logger = createLogger({ level: 'warn' });
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('visible');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should log with structured context', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger({ level: 'info' });

    logger.info('test message', { traceId: '123' });

    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0]!;
    expect(args[0]).toContain('test message');
  });

  it('should support silent level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger({ level: 'silent' });

    logger.error('hidden');
    expect(spy).not.toHaveBeenCalled();
  });

  it('should include timestamp in output', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger({ level: 'info' });

    logger.info('test');

    const output = spy.mock.calls[0]![0] as string;
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('should support child logger with prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger({ level: 'info' });
    const child = logger.child('ReactLoop');

    child.info('iteration done');

    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('ReactLoop');
  });
});
