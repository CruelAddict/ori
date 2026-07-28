export type RetryOptions = {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs?: number
  signal?: AbortSignal
  onRetry?: (error: unknown, attempt: number) => void
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  options.signal?.throwIfAborted()
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      options.signal?.throwIfAborted()
      if (attempt === options.maxAttempts) {
        throw error
      }
      options.onRetry?.(error, attempt)
      await wait(exponentialBackoffDelay(attempt, options), options.signal)
    }
  }
  throw new Error("retry attempts exhausted")
}

export function exponentialBackoffDelay(attempt: number, options: Pick<RetryOptions, "initialDelayMs" | "maxDelayMs">) {
  const delay = options.initialDelayMs * 2 ** Math.max(0, attempt - 1)
  return Math.min(delay, options.maxDelayMs ?? delay)
}

export function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(signal?.reason ?? new Error("retry aborted"))
    }
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
