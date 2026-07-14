export interface DraftPersister<T> {
  schedule(snapshot: T): void
  flush(): Promise<void>
  cancel(): void
}

export function createDraftPersister<T>(
  save: (snapshot: T) => Promise<void>,
  delay = 750,
): DraftPersister<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: T
  let hasPending = false
  let inFlight: Promise<void> | undefined

  async function savePending() {
    timer = undefined
    if (!hasPending) {
      return inFlight
    }

    const snapshot = pending
    hasPending = false
    const previous = inFlight?.catch(() => undefined)
    const operation = (previous ?? Promise.resolve()).then(() => save(snapshot))
    inFlight = operation
    const clearInFlight = () => {
      if (inFlight === operation) inFlight = undefined
    }
    void operation.then(clearInFlight, clearInFlight)
    await operation
  }

  return {
    schedule(snapshot) {
      pending = snapshot
      hasPending = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        void savePending().catch(() => undefined)
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
      hasPending = false
    },
  }
}
