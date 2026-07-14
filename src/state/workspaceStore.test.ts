import { describe, expect, it } from 'vitest'

import type { WorkspaceDocument, WorkspaceSnapshot } from '../domain/workspace'
import { createWorkspaceStore } from './workspaceStore'

function document(
  id: string,
  overrides: Partial<WorkspaceDocument> = {},
): WorkspaceDocument {
  return {
    id,
    name: `${id}.md`,
    virtualPath: `notes/${id}.md`,
    text: `${id} text`,
    savedText: `${id} text`,
    dirty: false,
    sourceKind: 'native',
    viewMode: 'source',
    updatedAt: 1,
    ...overrides,
  }
}

describe('workspace store', () => {
  it('adds documents by id, preserves their order, and selects the first document', () => {
    const store = createWorkspaceStore()
    const first = document('first')
    const second = document('second')

    store.getState().addDocuments([first, second, document('first', { text: 'duplicate' })])

    const state = store.getState()
    expect(state.documentOrder).toEqual(['first', 'second'])
    expect(state.documents).toEqual({ first, second })
    expect(state.activeDocumentId).toBe('first')

    store.getState().addDocuments([document('third')])
    expect(store.getState().documentOrder).toEqual(['first', 'second', 'third'])
    expect(store.getState().activeDocumentId).toBe('first')
  })

  it('switches only to a document that exists', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first'), document('second')])

    store.getState().setActiveDocument('second')
    expect(store.getState().activeDocumentId).toBe('second')

    store.getState().setActiveDocument('missing')
    expect(store.getState().activeDocumentId).toBe('second')
  })

  it('tracks dirty transitions against the last saved text', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first')])

    store.getState().updateDocumentText('first', 'edited', 10)
    expect(store.getState().documents.first).toMatchObject({
      text: 'edited',
      savedText: 'first text',
      dirty: true,
      updatedAt: 10,
    })

    store.getState().updateDocumentText('first', 'first text', 11)
    expect(store.getState().documents.first).toMatchObject({
      text: 'first text',
      dirty: false,
      updatedAt: 11,
    })
  })

  it('changes view mode without changing document content', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first')])

    store.getState().setDocumentViewMode('first', 'preview')

    expect(store.getState().documents.first).toEqual(
      document('first', { viewMode: 'preview' }),
    )
  })

  it('marks the current text saved by default', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first')])
    store.getState().updateDocumentText('first', 'edited', 10)

    store.getState().markDocumentSaved('first', {
      fingerprint: { lastModified: 20, size: 6 },
      updatedAt: 21,
    })

    expect(store.getState().documents.first).toMatchObject({
      text: 'edited',
      savedText: 'edited',
      dirty: false,
      diskFingerprint: { lastModified: 20, size: 6 },
      updatedAt: 21,
    })
  })

  it('keeps newer edits dirty when an earlier text finishes saving', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first')])
    store.getState().updateDocumentText('first', 'newest', 10)

    store.getState().markDocumentSaved('first', { text: 'written', updatedAt: 12 })

    expect(store.getState().documents.first).toMatchObject({
      text: 'newest',
      savedText: 'written',
      dirty: true,
      updatedAt: 12,
    })
  })

  it('restores a snapshot and serializes documents in workspace order', () => {
    const store = createWorkspaceStore()
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: 1,
      documents: [document('second'), document('first')],
      activeDocumentId: 'first',
      layoutJson: { global: { splitterSize: 4 } },
      theme: 'dark',
    }

    store.getState().restoreSnapshot(snapshot)

    expect(store.getState()).toMatchObject({
      documentOrder: ['second', 'first'],
      activeDocumentId: 'first',
      layoutJson: snapshot.layoutJson,
      theme: 'dark',
    })
    expect(store.getState().toSnapshot()).toEqual(snapshot)
  })

  it('removes the active document and selects its next or previous neighbor', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first'), document('second'), document('third')])
    store.getState().setActiveDocument('second')

    store.getState().removeDocument('second')
    expect(store.getState().documentOrder).toEqual(['first', 'third'])
    expect(store.getState().activeDocumentId).toBe('third')

    store.getState().removeDocument('third')
    expect(store.getState().activeDocumentId).toBe('first')

    store.getState().removeDocument('first')
    expect(store.getState().activeDocumentId).toBeNull()
  })

  it('keeps the active document when removing another document', () => {
    const store = createWorkspaceStore()
    store.getState().addDocuments([document('first'), document('second')])

    store.getState().removeDocument('second')

    expect(store.getState().activeDocumentId).toBe('first')
  })

  it('updates the serializable layout without touching documents', () => {
    const store = createWorkspaceStore()
    const first = document('first')
    const layoutJson = { layout: { type: 'row', children: [] } }
    store.getState().addDocuments([first])

    store.getState().setLayoutJson(layoutJson)

    expect(store.getState().layoutJson).toBe(layoutJson)
    expect(store.getState().documents.first).toEqual(first)
  })
})
