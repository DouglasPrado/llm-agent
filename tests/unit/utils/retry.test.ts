import { describe, it, expect, vi } from 'vitest';
import { retry } from '../../../src/utils/retry.js';

describe('Retry', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const result = await retry(fn, { maxRetries: 3, initialDelay: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      retry(fn, { maxRetries: 2, initialDelay: 1 })
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('should apply exponential backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await retry(fn, { maxRetries: 1, initialDelay: 50, backoffMultiplier: 2 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // at least ~50ms delay
  });

  it('should support AbortSignal', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    setTimeout(() => controller.abort(), 10);

    await expect(
      retry(fn, { maxRetries: 10, initialDelay: 50, signal: controller.signal })
    ).rejects.toThrow();
  });

  it('should support custom retryable check', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('retryable'))
      .mockRejectedValueOnce(new Error('not retryable'));

    await expect(
      retry(fn, {
        maxRetries: 3,
        initialDelay: 1,
        isRetryable: (err) => (err as Error).message === 'retryable',
      })
    ).rejects.toThrow('not retryable');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
