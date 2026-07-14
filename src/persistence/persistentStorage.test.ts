import { describe, expect, it, vi } from 'vitest'

import { requestPersistentStorage } from './persistentStorage'

describe('requestPersistentStorage', () => {
  it('returns the result of a persistence request', async () => {
    const persist = vi.fn().mockResolvedValue(true)

    await expect(requestPersistentStorage({ persist })).resolves.toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('returns false when persistence is missing or denied', async () => {
    await expect(requestPersistentStorage({})).resolves.toBe(false)
    await expect(
      requestPersistentStorage({ persist: vi.fn().mockResolvedValue(false) }),
    ).resolves.toBe(false)
  })

  it('returns false when the persistence request rejects or throws', async () => {
    await expect(
      requestPersistentStorage({ persist: vi.fn().mockRejectedValue(new Error('rejected')) }),
    ).resolves.toBe(false)
    await expect(
      requestPersistentStorage({
        persist: vi.fn(() => {
          throw new Error('failed')
        }),
      }),
    ).resolves.toBe(false)
  })
})
