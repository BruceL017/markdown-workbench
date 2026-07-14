import { openDB, type DBSchema } from 'idb'

import type { WorkspaceDocument, WorkspaceSnapshot } from '../domain/workspace'

const DATABASE_NAME = 'markdown-workbench'
const DATABASE_VERSION = 1
const RECENT_WORKSPACE_KEY = 'recent' as const

type StoredWorkspace = Omit<WorkspaceSnapshot, 'documents'>
type StoredDocument = WorkspaceDocument & { order: number }

interface WorkspaceDatabase extends DBSchema {
  documents: {
    key: string
    value: StoredDocument
  }
  workspace: {
    key: typeof RECENT_WORKSPACE_KEY
    value: StoredWorkspace
  }
  handles: {
    key: string
    value: FileSystemHandle
  }
}

export interface WorkspacePersistence {
  saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void>
  loadWorkspace(): Promise<WorkspaceSnapshot | null>
  saveHandle(handleKey: string, handle: FileSystemHandle): Promise<void>
  loadHandle(handleKey: string): Promise<FileSystemHandle | undefined>
  deleteHandle(handleKey: string): Promise<void>
  clear(): Promise<void>
}

export function createWorkspacePersistence(
  { dbName = DATABASE_NAME }: { dbName?: string } = {},
): WorkspacePersistence {
  const database = openDB<WorkspaceDatabase>(dbName, DATABASE_VERSION, {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'id' })
      db.createObjectStore('workspace')
      db.createObjectStore('handles')
    },
  })

  return {
    async saveWorkspace(snapshot) {
      const db = await database
      const transaction = db.transaction(['documents', 'workspace'], 'readwrite')

      try {
        await transaction.objectStore('documents').clear()
        for (const [order, document] of snapshot.documents.entries()) {
          await transaction.objectStore('documents').put({ ...document, order })
        }
        await transaction.objectStore('workspace').put(storedWorkspace(snapshot), RECENT_WORKSPACE_KEY)
        await transaction.done
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // The transaction was already aborted by IndexedDB.
        }
        try {
          await transaction.done
        } catch {
          // Consume the expected rejection from the aborted transaction.
        }
        throw error
      }
    },

    async loadWorkspace() {
      const db = await database
      const transaction = db.transaction(['documents', 'workspace'], 'readonly')
      const [workspace, documents] = await Promise.all([
        transaction.objectStore('workspace').get(RECENT_WORKSPACE_KEY),
        transaction.objectStore('documents').getAll(),
      ])
      await transaction.done

      if (!workspace) {
        return null
      }

      return {
        ...workspace,
        documents: documents.sort((left, right) => left.order - right.order).map(storedDocument),
      }
    },

    async saveHandle(handleKey, handle) {
      const db = await database
      await db.put('handles', handle, handleKey)
    },

    async loadHandle(handleKey) {
      const db = await database
      return db.get('handles', handleKey)
    },

    async deleteHandle(handleKey) {
      const db = await database
      await db.delete('handles', handleKey)
    },

    async clear() {
      const db = await database
      const transaction = db.transaction(['documents', 'workspace', 'handles'], 'readwrite')
      await Promise.all([
        transaction.objectStore('documents').clear(),
        transaction.objectStore('workspace').clear(),
        transaction.objectStore('handles').clear(),
        transaction.done,
      ])
    },
  }
}

function storedWorkspace(snapshot: WorkspaceSnapshot): StoredWorkspace {
  return {
    schemaVersion: snapshot.schemaVersion,
    activeDocumentId: snapshot.activeDocumentId,
    ...(snapshot.layoutJson === undefined ? {} : { layoutJson: snapshot.layoutJson }),
    ...(snapshot.theme === undefined ? {} : { theme: snapshot.theme }),
  }
}

function storedDocument({ order: _order, ...document }: StoredDocument): WorkspaceDocument {
  return document
}
