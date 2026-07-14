export interface DraftPersister<T> {
  schedule(snapshot: T): void
  flush(): Promise<void>
  cancel(): void
}

export function createDraftPersister<T>(
  save: (snapshot: T) => Promise<void>,
  delay = 750,
  onError?: (error: unknown, snapshot: T) => void | Promise<void>,
): DraftPersister<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: T
  let hasPending = false
  let inFlight: Promise<void> | undefined
  let revision = 0

  function notifyError(error: unknown, snapshot: T) {
    if (!onError) return
    try {
      void Promise.resolve(onError(error, snapshot)).catch(() => undefined)
    } catch {
      // Error reporting must not create another unhandled error.
    }
  }

  async function savePending(reportError = false) {
    timer = undefined
    if (!hasPending) {
      return inFlight
    }

    const snapshot = pending
    const snapshotRevision = revision
    hasPending = false
    const previous = inFlight?.catch(() => undefined)
    const operation = (previous ?? Promise.resolve()).then(() => save(snapshot))
    inFlight = operation

    try {
      await operation
    } catch (error) {
      if (revision === snapshotRevision) {
        pending = snapshot
        hasPending = true
      }
      if (reportError) {
        notifyError(error, snapshot)
      }
      throw error
    } finally {
      if (inFlight === operation) inFlight = undefined
    }
  }

  return {
    schedule(snapshot) {
      revision += 1
      pending = snapshot
      hasPending = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        void savePending(true).catch(() => undefined)
      }, delay)
    },

    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      await savePending()
    },

    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      timer = undefined
      revision += 1
      hasPending = false
    },
  }
}
