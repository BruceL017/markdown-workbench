import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceDocument, WorkspaceSnapshot } from '../domain/workspace'
import { AssetRegistry } from '../files/assetRegistry'
import { InMemoryFileHandleRegistry } from '../files/nativeFileAdapter'
import type { WorkspacePersistence } from '../persistence/indexedDbWorkspace'
import { createWorkspaceStore } from '../state/workspaceStore'
import { activeDocumentId, visibleDocumentIds } from '../layout/workbenchLayout'
import { createWorkspaceSession } from './workspaceSession'

function document(id: string, overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    id,
    name: `${id}.md`,
    virtualPath: `${id}.md`,
    text: `# ${id} draft`,
    savedText: `# ${id}`,
    dirty: true,
    sourceKind: 'fallback',
    viewMode: 'source',
    updatedAt: 10,
    ...overrides,
  }
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    documents: [document('first')],
    activeDocumentId: 'first',
    theme: 'dark',
    locale: 'zh-CN',
    ...overrides,
  }
}

function persistence(overrides: Partial<WorkspacePersistence> = {}): WorkspacePersistence {
  return {
    loadWorkspace: vi.fn(async () => null),
    saveWorkspace: vi.fn(async () => undefined),
    saveHandle: vi.fn(async () => undefined),
    loadHandle: vi.fn(async () => undefined),
    deleteHandle: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    ...overrides,
  }
}

function setup(workspacePersistence = persistence()) {
  const revoked: string[] = []
  const runtime = {
    store: createWorkspaceStore(),
    assetRegistry: new AssetRegistry({
      createObjectURL: () => 'blob:asset',
      revokeObjectURL: (url) => revoked.push(url),
    }),
    nativeHandleRegistry: new InMemoryFileHandleRegistry(),
    persistence: workspacePersistence,
  }
  return { runtime, revoked }
}

afterEach(() => vi.useRealTimers())

describe('workspace session', () => {
  it('hydrates drafts, active document, theme, layout, and handles without requesting permission', async () => {
    const handle = {
      kind: 'file',
      name: 'first.md',
      requestPermission: vi.fn(),
    } as unknown as FileSystemFileHandle
    const restored = snapshot({
      documents: [document('first', { sourceKind: 'native', handleKey: 'handle:first' })],
    })
    const workspacePersistence = persistence({
      loadWorkspace: vi.fn(async () => restored),
      loadHandle: vi.fn(async () => handle),
    })
    const { runtime } = setup(workspacePersistence)
    const session = createWorkspaceSession(runtime, {
      requestPersistentStorage: vi.fn(async () => true),
    })

    const result = await session.hydrate()

    expect(runtime.store.getState().documents.first).toEqual(restored.documents[0])
    expect(runtime.store.getState().theme).toBe('dark')
    expect(runtime.store.getState().locale).toBe('zh-CN')
    expect(activeDocumentId(result.model)).toBe('first')
    expect(runtime.nativeHandleRegistry.get('handle:first')).toBe(handle)
    expect(handle.requestPermission).not.toHaveBeenCalled()
  })

  it('ignores stale and corrupt snapshots without overwriting current state', async () => {
    for (const loaded of [
      { ...snapshot(), schemaVersion: 2 },
      { ...snapshot(), locale: 'fr' },
      { schemaVersion: 1, documents: [{ id: 'broken' }], activeDocumentId: 'broken' },
    ]) {
      const workspacePersistence = persistence({
        loadWorkspace: vi.fn(async () => loaded as unknown as WorkspaceSnapshot),
      })
      const { runtime } = setup(workspacePersistence)
      runtime.store.getState().addDocuments([document('current')])
      const session = createWorkspaceSession(runtime)

      const result = await session.hydrate()

      expect(runtime.store.getState().documentOrder).toEqual(['current'])
      expect(visibleDocumentIds(result.model)).toEqual(['current'])
    }
  })

  it('coalesces store changes for exactly 750ms and reports a retryable failure', async () => {
    vi.useFakeTimers()
    const failure = new Error('quota full')
    const saveWorkspace = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const onError = vi.fn()
    const { runtime } = setup(persistence({ saveWorkspace }))
    const session = createWorkspaceSession(runtime, { onError })
    await session.hydrate()
    session.start()

    runtime.store.getState().addDocuments([document('first')])
    await vi.advanceTimersByTimeAsync(400)
    runtime.store.getState().updateDocumentText('first', '# latest')
    await vi.advanceTimersByTimeAsync(749)
    expect(saveWorkspace).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(saveWorkspace).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)

    await session.flush()
    expect(saveWorkspace).toHaveBeenCalledTimes(2)
    expect(saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        documents: [expect.objectContaining({ id: 'first', text: '# latest' })],
      }),
    )
  })

  it('flushes a removed document before deleting its saved handle', async () => {
    const saveWorkspace = vi.fn(async () => undefined)
    const deleteHandle = vi.fn(async () => undefined)
    const workspacePersistence = persistence({ saveWorkspace, deleteHandle })
    const { runtime } = setup(workspacePersistence)
    const session = createWorkspaceSession(runtime, {
      requestPersistentStorage: vi.fn(async () => true),
    })
    const removed = document('native', {
      sourceKind: 'native',
      handleKey: 'handle:native',
    })
    const handle = { kind: 'file', name: 'native.md' } as FileSystemFileHandle
    runtime.nativeHandleRegistry.set('handle:native', handle)
    await session.hydrate()
    session.start()
    runtime.store.getState().addDocuments([removed])
    runtime.store.getState().removeDocument(removed.id)

    await session.forgetDocument(removed)

    expect(saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ documents: [] }))
    expect(deleteHandle).toHaveBeenCalledWith('handle:native')
    expect(runtime.nativeHandleRegistry.get('handle:native')).toBeUndefined()
  })

  it('leaves asset lifecycle to the synchronous workspace removal flow', async () => {
    const { runtime, revoked } = setup()
    const session = createWorkspaceSession(runtime, {
      requestPersistentStorage: vi.fn(async () => true),
    })
    const removed = document('removed')
    runtime.assetRegistry.register('images/shared.png', new File(['asset'], 'shared.png'))
    await runtime.assetRegistry.resolve('images/shared.png')
    await session.hydrate()
    session.start()
    runtime.store.getState().addDocuments([removed])
    runtime.store.getState().removeDocument(removed.id)

    await session.forgetDocument(removed)

    expect(revoked).toEqual([])
    expect(await runtime.assetRegistry.resolve('images/shared.png')).toBe('blob:asset')
  })

  it('stores only accepted native handles supplied after dedupe', async () => {
    const saveHandle = vi.fn(async () => undefined)
    const { runtime } = setup(persistence({ saveHandle }))
    const handle = { kind: 'file', name: 'native.md' } as unknown as FileSystemFileHandle
    runtime.nativeHandleRegistry.set('native:one', handle)
    const session = createWorkspaceSession(runtime)

    await session.persistHandles([
      document('one', { sourceKind: 'native', handleKey: 'native:one' }),
      document('fallback'),
    ])

    expect(saveHandle).toHaveBeenCalledOnce()
    expect(saveHandle).toHaveBeenCalledWith('native:one', handle)
  })

  it('cancels pending writes when clearing and can persist new work afterwards', async () => {
    vi.useFakeTimers()
    const saveWorkspace = vi.fn(async () => undefined)
    const clear = vi.fn(async () => undefined)
    const { runtime, revoked } = setup(persistence({ saveWorkspace, clear }))
    const session = createWorkspaceSession(runtime)
    await session.hydrate()
    session.start()

    runtime.store.getState().addDocuments([document('old')])
    runtime.assetRegistry.register('image.png', new File(['image'], 'image.png'))
    await runtime.assetRegistry.resolve('image.png')
    runtime.nativeHandleRegistry.set(
      'old-handle',
      { kind: 'file', name: 'old.md' } as unknown as FileSystemFileHandle,
    )

    await session.clear()
    await vi.advanceTimersByTimeAsync(750)

    expect(saveWorkspace).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalledOnce()
    expect(runtime.store.getState().documentOrder).toEqual([])
    expect(runtime.nativeHandleRegistry.get('old-handle')).toBeUndefined()
    expect(revoked).toEqual(['blob:asset'])

    runtime.store.getState().addDocuments([document('new')])
    await vi.advanceTimersByTimeAsync(750)
    expect(saveWorkspace).toHaveBeenCalledOnce()
    expect(saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ documents: [expect.objectContaining({ id: 'new' })] }),
    )
  })

  it('waits for an in-flight draft write before clearing so it cannot finish afterwards', async () => {
    vi.useFakeTimers()
    let finishSave!: () => void
    const saveWorkspace = vi.fn(
      () => new Promise<void>((resolve) => { finishSave = resolve }),
    )
    const clear = vi.fn(async () => undefined)
    const { runtime } = setup(persistence({ saveWorkspace, clear }))
    const session = createWorkspaceSession(runtime)
    await session.hydrate()
    session.start()
    runtime.store.getState().addDocuments([document('in-flight')])
    await vi.advanceTimersByTimeAsync(750)

    let cleared = false
    const clearing = session.clear().then(() => { cleared = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(cleared).toBe(false)
    expect(clear).not.toHaveBeenCalled()

    finishSave()
    await clearing
    expect(clear).toHaveBeenCalledOnce()
    expect(runtime.store.getState().documentOrder).toEqual([])
  })

  it('restarts recovery persistence when clearing IndexedDB fails', async () => {
    vi.useFakeTimers()
    const saveWorkspace = vi.fn(async () => undefined)
    const clear = vi.fn(async () => { throw new Error('clear failed') })
    const { runtime } = setup(persistence({ saveWorkspace, clear }))
    const session = createWorkspaceSession(runtime)
    await session.hydrate()
    session.start()
    runtime.store.getState().addDocuments([document('kept')])

    await expect(session.clear()).rejects.toThrow('clear failed')
    expect(runtime.store.getState().documents.kept).toBeDefined()
    await vi.advanceTimersByTimeAsync(750)
    expect(saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ documents: [expect.objectContaining({ id: 'kept' })] }),
    )

    runtime.store.getState().updateDocumentText('kept', '# still recovering')
    await vi.advanceTimersByTimeAsync(750)
    expect(saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        documents: [expect.objectContaining({ text: '# still recovering' })],
      }),
    )
  })
})
