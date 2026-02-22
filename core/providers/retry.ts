interface RetryOptions {
  retries: number;
  delayMs: number;
}

/**
 * Simple exponential backoff for async generators (like provider streams).
 */
export async function* retryStream<T>(
  fn: () => AsyncGenerator<T>,
  { retries, delayMs }: RetryOptions,
): AsyncGenerator<T> {
  try {
    yield* fn();
  } catch (e) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield* retryStream(fn, { retries: retries - 1, delayMs: delayMs * 2 });
    } else {
      throw e;
    }
  }
}
