import { describe, expect, it, vi } from 'vitest'

import { AssetRegistry } from './assetRegistry'

function createUrlApi() {
  let nextId = 0

  return {
    createObjectURL: vi.fn(() => `blob:test-${++nextId}`),
    revokeObjectURL: vi.fn(),
  }
}

describe('AssetRegistry', () => {
  it('loads lazily and reuses the object URL for sequential and concurrent resolves', async () => {
    const urlApi = createUrlApi()
    const loader = vi.fn(async () => new File(['image'], 'cover.png'))
    const registry = new AssetRegistry(urlApi)
    registry.register('images/./cover.png', loader)

    expect(loader).not.toHaveBeenCalled()

    const [first, second] = await Promise.all([
      registry.resolve('images/cover.png'),
      registry.resolve('images//cover.png'),
    ])

    expect(first).toBe('blob:test-1')
    expect(second).toBe(first)
    expect(await registry.resolve('images/cover.png')).toBe(first)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('returns undefined for an unregistered path without loading anything', async () => {
    const registry = new AssetRegistry(createUrlApi())

    await expect(registry.resolve('images/missing.png')).resolves.toBeUndefined()
  })

  it('revokes an existing URL when register replaces the asset', async () => {
    const urlApi = createUrlApi()
    const registry = new AssetRegistry(urlApi)
    registry.register('images/cover.png', new File(['old'], 'cover.png'))
    await registry.resolve('images/cover.png')

    registry.register('images/cover.png', new File(['new'], 'cover.png'))

    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
    await expect(registry.resolve('images/cover.png')).resolves.toBe('blob:test-2')
  })

  it('clears every registered asset and revokes materialized URLs', async () => {
    const urlApi = createUrlApi()
    const registry = new AssetRegistry(urlApi)
    registry.register('images/one.png', new File(['one'], 'one.png'))
    registry.register('images/two.png', new File(['two'], 'two.png'))
    await registry.resolve('images/one.png')
    await registry.resolve('images/two.png')

    registry.clear()

    expect(urlApi.revokeObjectURL.mock.calls).toEqual([
      ['blob:test-1'],
      ['blob:test-2'],
    ])
    await expect(registry.resolve('images/one.png')).resolves.toBeUndefined()
  })

  it('revokes a URL produced by a loader that finishes after clear', async () => {
    const urlApi = createUrlApi()
    let finishLoading!: (file: File) => void
    const loader = vi.fn(
      () => new Promise<File>((resolve) => {
        finishLoading = resolve
      }),
    )
    const registry = new AssetRegistry(urlApi)
    registry.register('images/slow.png', loader)
    const pendingUrl = registry.resolve('images/slow.png')

    registry.clear()
    finishLoading(new File(['slow'], 'slow.png'))

    await expect(pendingUrl).resolves.toBeUndefined()
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
  })

  it('replace revokes old URLs and installs lazy replacement entries', async () => {
    const urlApi = createUrlApi()
    const loader = vi.fn(async () => new File(['new'], 'new.png'))
    const registry = new AssetRegistry(urlApi)
    registry.register('images/old.png', new File(['old'], 'old.png'))
    await registry.resolve('images/old.png')

    registry.replace([['images/new.png', loader]])

    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
    expect(loader).not.toHaveBeenCalled()
    await expect(registry.resolve('images/old.png')).resolves.toBeUndefined()
    await expect(registry.resolve('images/new.png')).resolves.toBe('blob:test-2')
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
