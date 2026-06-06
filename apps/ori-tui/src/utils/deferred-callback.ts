export type DeferredCallback = (() => void) & {
  cancel: () => void
}

export function createDeferredCallback(callback: () => void): DeferredCallback {
  let queued = false

  const cancel = () => {
    queued = false
  }

  const deferred = () => {
    if (queued) {
      return
    }

    queued = true
    queueMicrotask(() => {
      if (!queued) {
        return
      }

      queued = false
      callback()
    })
  }

  return Object.assign(deferred, { cancel })
}
