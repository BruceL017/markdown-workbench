import { describe, expectTypeOf, it } from 'vitest'

import type {
  DiskFingerprint,
  DocumentSourceKind,
  ViewMode,
  WorkspaceDocument,
  WorkspaceSnapshot,
} from './workspace'

describe('workspace domain types', () => {
  it('exposes the persisted workspace contract', () => {
    expectTypeOf<ViewMode>().toEqualTypeOf<'source' | 'preview'>()
    expectTypeOf<DocumentSourceKind>().toEqualTypeOf<'native' | 'fallback' | 'cache'>()
    expectTypeOf<DiskFingerprint>().toEqualTypeOf<{
      lastModified: number
      size: number
    }>()

    expectTypeOf<WorkspaceDocument>().toMatchTypeOf<{
      id: string
      name: string
      virtualPath: string
      text: string
      savedText: string
      dirty: boolean
      sourceKind: DocumentSourceKind
      viewMode: ViewMode
      updatedAt: number
      diskFingerprint?: DiskFingerprint
      handleKey?: string
    }>()

    expectTypeOf<WorkspaceSnapshot>().toEqualTypeOf<{
      schemaVersion: 1
      documents: WorkspaceDocument[]
      activeDocumentId: string | null
      layoutJson?: unknown
      theme?: 'system' | 'light' | 'dark'
    }>()
  })
})
