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
})
