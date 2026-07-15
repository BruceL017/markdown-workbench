import type { Model } from 'flexlayout-react'

import type { WorkspaceDocument, WorkspaceSnapshot } from '../domain/workspace'
import type { AssetRegistry } from '../files/assetRegistry'
import type { FileHandleRegistry } from '../files/nativeFileAdapter'
import {
  activeDocumentId,
  restoreWorkspaceModel,
  serializeWorkbenchLayout,
} from '../layout/workbenchLayout'
import { createDraftPersister, type DraftPersister } from '../persistence/draftPersister'
import type { WorkspacePersistence } from '../persistence/indexedDbWorkspace'
import { requestPersistentStorage as requestStoragePersistence } from '../persistence/persistentStorage'
import type { createWorkspaceStore } from '../state/workspaceStore'

interface SessionRuntime {
  store: ReturnType<typeof createWorkspaceStore>
  assetRegistry: AssetRegistry
  nativeHandleRegistry: FileHandleRegistry
  persistence?: WorkspacePersistence
}

interface WorkspaceSessionOptions {
  onError?: (error: unknown) => void
  requestPersistentStorage?: () => Promise<boolean>
}

export interface WorkspaceSession {
  hydrate(): Promise<{ model: Model; restored: boolean }>
  start(): void
  flush(): Promise<void>
  persistHandles(documents: WorkspaceDocument[]): Promise<void>
  forgetDocument(document: WorkspaceDocument): Promise<void>
  clear(): Promise<void>
  dispose(): void
}

export function createWorkspaceSession(
  runtime: SessionRuntime,
  options: WorkspaceSessionOptions = {},
): WorkspaceSession {
  const persistence = runtime.persistence
  const requestPersistentStorage = options.requestPersistentStorage ?? requestStoragePersistence
  let persister: DraftPersister<WorkspaceSnapshot> | undefined
  let unsubscribe: (() => void) | undefined
  let hydration: Promise<{ model: Model; restored: boolean }> | undefined

  const report = (error: unknown) => {
    try {
      options.onError?.(error)
    } catch {
      // Persistence error reporting must not interrupt recovery or cleanup.
    }
  }

  function ensurePersister() {
    if (!persistence) return undefined
    persister ??= createDraftPersister(
      (snapshot) => persistence.saveWorkspace(snapshot),
      750,
      (error) => report(error),
    )
    return persister
  }

  function modelForCurrentWorkspace() {
    const state = runtime.store.getState()
    const documents = state.documentOrder.map((id) => state.documents[id])
    return restoreWorkspaceModel(
      state.layoutJson,
      documents,
      state.activeDocumentId,
    )
  }

  async function hydrate() {
    let restored = false
    if (persistence) {
      try {
        const snapshot = validateSnapshot(await persistence.loadWorkspace())
        if (snapshot) {
          runtime.store.getState().restoreSnapshot(snapshot)
          restored = true

          for (const document of snapshot.documents) {
            if (!document.handleKey) continue
            try {
              const handle = await persistence.loadHandle(document.handleKey)
              if (handle?.kind === 'file') {
                runtime.nativeHandleRegistry.set(
                  document.handleKey,
                  handle as FileSystemFileHandle,
                )
              }
            } catch (error) {
              report(error)
            }
          }
        }
      } catch (error) {
        report(error)
      }

      void requestPersistentStorage().catch(report)
    }

    const model = modelForCurrentWorkspace()
    runtime.store.getState().setLayoutJson(serializeWorkbenchLayout(model))
    runtime.store.getState().setActiveDocument(activeDocumentId(model))
    return { model, restored }
  }

  const session: WorkspaceSession = {
    hydrate() {
      hydration ??= hydrate()
      return hydration
    },

    start() {
      if (unsubscribe || !persistence) return
      const draftPersister = ensurePersister()
      unsubscribe = runtime.store.subscribe(() => {
        draftPersister?.schedule(runtime.store.getState().toSnapshot())
      })
    },

    async flush() {
      await persister?.flush()
    },

    async persistHandles(documents) {
      if (!persistence) return
      const saved = new Set<string>()
      for (const document of documents) {
        const handleKey = document.handleKey
        if (!handleKey || saved.has(handleKey)) continue
        const handle = runtime.nativeHandleRegistry.get(handleKey)
        if (!handle) continue
        saved.add(handleKey)
        try {
          await persistence.saveHandle(handleKey, handle)
        } catch (error) {
          report(error)
        }
      }
    },

    async forgetDocument(document) {
      await persister?.flush()
      if (document.handleKey) {
        await persistence?.deleteHandle(document.handleKey)
        runtime.nativeHandleRegistry.delete(document.handleKey)
      }
    },

    async clear() {
      unsubscribe?.()
      unsubscribe = undefined
      persister?.cancel()
      try {
        await persister?.flush()
      } catch {
        // A failed draft write must not prevent an explicit local-data clear.
      }
      let cleared = false
      try {
        await persistence?.clear()
        runtime.nativeHandleRegistry.clear()
        runtime.assetRegistry.clear()
        runtime.store.getState().resetWorkspace()
        cleared = true
      } finally {
        session.start()
        if (!cleared) {
          ensurePersister()?.schedule(runtime.store.getState().toSnapshot())
        }
      }
    },

    dispose() {
      unsubscribe?.()
      unsubscribe = undefined
      void persister?.flush().catch(report)
    },
  }
  return session
}

function validateSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkspaceSnapshot>
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.documents)) return null
  if (!candidate.documents.every(isWorkspaceDocument)) return null
  if (candidate.activeDocumentId !== null && typeof candidate.activeDocumentId !== 'string') {
    return null
  }
  if (
    candidate.theme !== undefined &&
    candidate.theme !== 'system' &&
    candidate.theme !== 'light' &&
    candidate.theme !== 'dark'
  ) {
    return null
  }
  if (candidate.locale !== undefined && candidate.locale !== 'zh-CN' && candidate.locale !== 'en') {
    return null
  }
  return candidate as WorkspaceSnapshot
}

function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<WorkspaceDocument>
  return (
    typeof document.id === 'string' &&
    typeof document.name === 'string' &&
    typeof document.virtualPath === 'string' &&
    typeof document.text === 'string' &&
    typeof document.savedText === 'string' &&
    typeof document.dirty === 'boolean' &&
    (document.sourceKind === 'native' ||
      document.sourceKind === 'fallback' ||
      document.sourceKind === 'cache') &&
    (document.viewMode === 'source' || document.viewMode === 'preview') &&
    typeof document.updatedAt === 'number' &&
    (document.handleKey === undefined || typeof document.handleKey === 'string')
  )
}
