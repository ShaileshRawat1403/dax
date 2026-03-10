export function isTransientLockedError(error: unknown) {
  return error instanceof Error && /database is locked/i.test(error.message)
}

export async function withLockedRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 100,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (retries > 0 && isTransientLockedError(error)) {
      await Bun.sleep(delayMs)
      return withLockedRetry(fn, retries - 1, delayMs)
    }
    throw error
  }
}
