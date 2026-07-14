import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDraftPersister } from './draftPersister'

afterEach(() => {
  vi.useRealTimers()
})

describe('createDraftPersister', () => {
  it('debounces for 750ms and saves only the latest scheduled snapshot', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const persister = createDraftPersister(save)
    const first = { text: 'first' }
    const latest = { text: 'latest' }

    persister.schedule(first)
    await vi.advanceTimersByTimeAsync(400)
    persister.schedule(latest)
    await vi.advanceTimersByTimeAsync(749)

    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(latest)
  })

  it('flushes a pending snapshot immediately without a later duplicate save', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const persister = createDraftPersister(save)
    const pending = { text: 'pending' }

    persister.schedule(pending)
    await persister.flush()
    await vi.advanceTimersByTimeAsync(750)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(pending)
  })

  it('waits for an automatic save that is already in flight', async () => {
    vi.useFakeTimers()
    let finishSaving!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = resolve
        }),
    )
    const persister = createDraftPersister(save)
    persister.schedule({ text: 'pending' })
    await vi.advanceTimersByTimeAsync(750)

    let flushed = false
    const flush = persister.flush().then(() => {
      flushed = true
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(flushed).toBe(false)

    finishSaving()
    await flush
    expect(flushed).toBe(true)
  })

  it('cancels a pending save', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const persister = createDraftPersister(save)

    persister.schedule({ text: 'discarded' })
    persister.cancel()
    await vi.advanceTimersByTimeAsync(750)

    expect(save).not.toHaveBeenCalled()
    await expect(persister.flush()).resolves.toBeUndefined()
  })

  it('contains an automatic save failure and continues scheduling', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    const persister = createDraftPersister(save)
    const retry = { text: 'retry' }

    persister.schedule({ text: 'fails' })
    await vi.advanceTimersByTimeAsync(750)
    persister.schedule(retry)
    await vi.advanceTimersByTimeAsync(750)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(retry)
  })

  it('reports an automatic save failure with its snapshot', async () => {
    vi.useFakeTimers()
    const failure = new Error('storage unavailable')
    const save = vi.fn().mockRejectedValue(failure)
    const onError = vi.fn()
    const persister = createDraftPersister(save, 750, onError)
    const snapshot = { text: 'failed' }

    persister.schedule(snapshot)
    await vi.advanceTimersByTimeAsync(750)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure, snapshot)
  })

  it('retains an automatically failed snapshot for flush to retry', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    const persister = createDraftPersister(save)
    const snapshot = { text: 'retry me' }

    persister.schedule(snapshot)
    await vi.advanceTimersByTimeAsync(750)
    await persister.flush()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, snapshot)
    expect(save).toHaveBeenNthCalledWith(2, snapshot)
  })

  it('does not restore an in-flight failure over a newer scheduled snapshot', async () => {
    vi.useFakeTimers()
    let rejectFirst!: (error: Error) => void
    const failure = new Error('first failed')
    const first = { text: 'first' }
    const latest = { text: 'latest' }
    const save = vi.fn((snapshot: { text: string }) => {
      if (snapshot === first) {
        return new Promise<void>((_resolve, reject) => {
          rejectFirst = reject
        })
      }
      return Promise.resolve()
    })
    const onError = vi.fn()
    const persister = createDraftPersister(save, 750, onError)

    persister.schedule(first)
    await vi.advanceTimersByTimeAsync(750)
    persister.schedule(latest)
    rejectFirst(failure)

    await persister.flush()
    await vi.advanceTimersByTimeAsync(750)

    expect(onError).toHaveBeenCalledWith(failure, first)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, first)
    expect(save).toHaveBeenNthCalledWith(2, latest)
  })

  it('does not restore an in-flight failure after cancellation', async () => {
    vi.useFakeTimers()
    let rejectSave!: (error: Error) => void
    const failure = new Error('storage unavailable')
    const snapshot = { text: 'discarded' }
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    const onError = vi.fn()
    const persister = createDraftPersister(save, 750, onError)

    persister.schedule(snapshot)
    await vi.advanceTimersByTimeAsync(750)
    persister.cancel()
    rejectSave(failure)
    await vi.advanceTimersByTimeAsync(0)

    expect(onError).toHaveBeenCalledWith(failure, snapshot)
    await expect(persister.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancels a snapshot retained after an automatic failure', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    const persister = createDraftPersister(save)

    persister.schedule({ text: 'discarded' })
    await vi.advanceTimersByTimeAsync(750)
    persister.cancel()

    await expect(persister.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('contains errors thrown while reporting an automatic failure', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    const onError = vi.fn(() => {
      throw new Error('observer failed')
    })
    const persister = createDraftPersister(save, 750, onError)
    const snapshot = { text: 'retry me' }

    persister.schedule(snapshot)
    await vi.advanceTimersByTimeAsync(750)

    expect(onError).toHaveBeenCalledTimes(1)
    await expect(persister.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('contains rejected async error observers and keeps the snapshot retryable', async () => {
    const unhandled: unknown[] = []
    const processListener = (reason: unknown) => unhandled.push(reason)
    const browserListener = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    const rejectionEmitter = (globalThis as unknown as {
      process: {
        on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
        off(event: 'unhandledRejection', listener: (reason: unknown) => void): void
      }
    }).process
    rejectionEmitter.on('unhandledRejection', processListener)
    window.addEventListener('unhandledrejection', browserListener)

    try {
      const save = vi
        .fn()
        .mockRejectedValueOnce(new Error('storage unavailable'))
        .mockResolvedValueOnce(undefined)
      const snapshot = { text: 'retry me' }
      let reportedSnapshot: typeof snapshot | undefined
      const onError = async (_error: unknown, reported: typeof snapshot) => {
        reportedSnapshot = reported
        throw new Error('async observer failed')
      }
      const persister = createDraftPersister(save, 0, onError)

      persister.schedule(snapshot)
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(reportedSnapshot).toBe(snapshot)
      expect(unhandled).toEqual([])
      await expect(persister.flush()).resolves.toBeUndefined()
      expect(save).toHaveBeenCalledTimes(2)
    } finally {
      rejectionEmitter.off('unhandledRejection', processListener)
      window.removeEventListener('unhandledrejection', browserListener)
    }
  })

  it('propagates flush failures without changing the caller snapshot', async () => {
    vi.useFakeTimers()
    const failure = new Error('storage unavailable')
    const save = vi.fn().mockRejectedValue(failure)
    const persister = createDraftPersister(save)
    const pending = { text: 'keep me', nested: { dirty: true } }

    persister.schedule(pending)

    await expect(persister.flush()).rejects.toBe(failure)
    expect(pending).toEqual({ text: 'keep me', nested: { dirty: true } })
    expect(save).toHaveBeenCalledWith(pending)
  })

  it('keeps a failed flush retryable until it succeeds', async () => {
    vi.useFakeTimers()
    const firstFailure = new Error('first failure')
    const secondFailure = new Error('second failure')
    const save = vi
      .fn()
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(secondFailure)
      .mockResolvedValueOnce(undefined)
    const persister = createDraftPersister(save)
    const snapshot = { text: 'keep retrying' }

    persister.schedule(snapshot)

    await expect(persister.flush()).rejects.toBe(firstFailure)
    await expect(persister.flush()).rejects.toBe(secondFailure)
    await expect(persister.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(3)
    expect(save).toHaveBeenNthCalledWith(1, snapshot)
    expect(save).toHaveBeenNthCalledWith(2, snapshot)
    expect(save).toHaveBeenNthCalledWith(3, snapshot)
  })

  it('rejects flush failures without reporting them through onError', async () => {
    vi.useFakeTimers()
    const failure = new Error('storage unavailable')
    const save = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const onError = vi.fn()
    const persister = createDraftPersister(save, 750, onError)
    const snapshot = { text: 'retry me' }

    persister.schedule(snapshot)

    await expect(persister.flush()).rejects.toBe(failure)
    expect(onError).not.toHaveBeenCalled()
    await expect(persister.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
  })
})
