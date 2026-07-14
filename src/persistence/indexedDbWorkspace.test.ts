import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import type { WorkspaceDocument, WorkspaceSnapshot } from '../domain/workspace'
import { createWorkspacePersistence } from './indexedDbWorkspace'

let databaseSequence = 0

function databaseName() {
  databaseSequence += 1
  return `markdown-workbench-test-${databaseSequence}`
}

function document(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    id: 'document-a',
    name: 'notes.md',
    virtualPath: 'notes.md',
    text: '# Draft',
    savedText: '# Saved',
    dirty: true,
    sourceKind: 'native',
    viewMode: 'source',
    updatedAt: 123,
    diskFingerprint: { lastModified: 100, size: 7 },
    handleKey: 'handle-a',
    ...overrides,
  }
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    documents: [document()],
    activeDocumentId: 'document-a',
    layoutJson: { orientation: 'horizontal' },
    theme: 'dark',
    ...overrides,
  }
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

describe('createWorkspacePersistence', () => {
  it('creates a version 1 database and stores workspace metadata separately from documents', async () => {
    const name = databaseName()
    const persistence = createWorkspacePersistence({ dbName: name })
    const current = snapshot()

    await persistence.saveWorkspace(current)

    const database = await openDatabase(name)
    expect(database.version).toBe(1)
    expect(Array.from(database.objectStoreNames).sort()).toEqual([
      'documents',
      'handles',
      'workspace',
    ])

    const transaction = database.transaction(['documents', 'workspace'], 'readonly')
    const storedWorkspace = await requestResult(
      transaction.objectStore('workspace').get('recent'),
    )
    const storedDocuments = await requestResult(transaction.objectStore('documents').getAll())

    expect(storedWorkspace).toEqual({
      schemaVersion: 1,
      activeDocumentId: 'document-a',
      layoutJson: { orientation: 'horizontal' },
      theme: 'dark',
    })
    expect(storedWorkspace).not.toHaveProperty('documents')
    expect(storedDocuments).toEqual(current.documents.map((item, order) => ({ ...item, order })))
    database.close()
  })

  it('round-trips the recent workspace and replaces obsolete documents', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })
    const first = snapshot({
      documents: [document(), document({ id: 'obsolete', name: 'obsolete.md' })],
    })
    const latest = snapshot({
      documents: [
        document({
          id: 'latest',
          name: 'latest.md',
          virtualPath: 'latest.md',
          handleKey: undefined,
        }),
      ],
      activeDocumentId: 'latest',
      layoutJson: undefined,
      theme: 'light',
    })

    await persistence.saveWorkspace(first)
    await persistence.saveWorkspace(latest)

    expect(await persistence.loadWorkspace()).toEqual(latest)
  })

  it('preserves document order independently of document ids', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })
    const current = snapshot({
      documents: [
        document({ id: 'z-last', name: 'first.md' }),
        document({ id: 'a-first', name: 'second.md' }),
        document({ id: 'm-middle', name: 'third.md' }),
      ],
      activeDocumentId: 'z-last',
    })

    await persistence.saveWorkspace(current)

    expect(await persistence.loadWorkspace()).toEqual(current)
  })

  it('structured-clones handles in their own store without workspace saves deleting them', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })
    const handle = {
      kind: 'file',
      name: 'notes.md',
      metadata: { revision: 1 },
    }

    await persistence.saveHandle('handle-a', handle as unknown as FileSystemHandle)
    handle.metadata.revision = 2
    await persistence.saveWorkspace(snapshot())

    const restored = await persistence.loadHandle('handle-a')
    expect(restored).toEqual({
      kind: 'file',
      name: 'notes.md',
      metadata: { revision: 1 },
    })
    expect(restored).not.toBe(handle)
  })

  it('deletes one stored handle without affecting another', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })
    const first = { kind: 'file', name: 'first.md' }
    const second = { kind: 'file', name: 'second.md' }

    await persistence.saveHandle('handle-a', first as unknown as FileSystemHandle)
    await persistence.saveHandle('handle-b', second as unknown as FileSystemHandle)

    await persistence.deleteHandle('handle-a')

    expect(await persistence.loadHandle('handle-a')).toBeUndefined()
    expect(await persistence.loadHandle('handle-b')).toEqual(second)
  })

  it('restores workspace documents even when their handles are unavailable', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })
    const current = snapshot()

    await persistence.saveWorkspace(current)

    expect(await persistence.loadHandle('handle-a')).toBeUndefined()
    expect(await persistence.loadWorkspace()).toEqual(current)
  })

  it('clears workspace metadata, documents, and handles', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })

    await persistence.saveWorkspace(snapshot())
    await persistence.saveHandle(
      'handle-a',
      { kind: 'file', name: 'notes.md' } as unknown as FileSystemHandle,
    )
    await persistence.clear()

    expect(await persistence.loadWorkspace()).toBeNull()
    expect(await persistence.loadHandle('handle-a')).toBeUndefined()
  })

  it('does not mutate caller state or replace the last good workspace when a save fails', async () => {
    const persistence = createWorkspacePersistence({ dbName: databaseName() })
    const lastGood = snapshot()
    const failing = snapshot({
      activeDocumentId: 'failing',
      documents: [document({ id: 'failing' })],
    })
    const uncloneable = () => undefined
    const failingDocument = failing.documents[0] as WorkspaceDocument & {
      uncloneable: () => undefined
    }
    failingDocument.uncloneable = uncloneable

    await persistence.saveWorkspace(lastGood)

    await expect(persistence.saveWorkspace(failing)).rejects.toMatchObject({
      name: 'DataCloneError',
    })
    expect(failing.documents[0]).toBe(failingDocument)
    expect(failingDocument.uncloneable).toBe(uncloneable)
    expect(failing.activeDocumentId).toBe('failing')
    expect(await persistence.loadWorkspace()).toEqual(lastGood)
  })
})
