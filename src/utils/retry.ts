export interface RetryOptions {
  maxRetries: number;
  initialDelay?: number;
  backoffMultiplier?: number;
  maxDelay?: number;
  signal?: AbortSignal;
  isRetryable?: (error: unknown) => boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    }, { once: true });
  });
}

/**
 * Retries an async function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    initialDelay = 1000,
    backoffMultiplier = 2,
    maxDelay = 30_000,
    signal,
    isRetryable = () => true,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Aborted');
      }
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }

      const delay = Math.min(initialDelay * backoffMultiplier ** attempt, maxDelay);
      await sleep(delay, signal);
    }
  }

  throw lastError;
}
