import { createStore } from 'zustand/vanilla'

import type {
  DiskFingerprint,
  Locale,
  ThemePreference,
  ViewMode,
  WorkspaceDocument,
  WorkspaceSnapshot,
} from '../domain/workspace'

interface MarkDocumentSavedOptions {
  text?: string
  fingerprint?: DiskFingerprint
  updatedAt?: number
}

export interface WorkspaceState {
  documents: Record<string, WorkspaceDocument>
  documentOrder: string[]
  activeDocumentId: string | null
  layoutJson?: unknown
  theme: ThemePreference
  locale: Locale | null
}

export interface WorkspaceActions {
  addDocuments: (documents: WorkspaceDocument[]) => void
  setActiveDocument: (id: string | null) => void
  updateDocumentText: (id: string, text: string, updatedAt?: number) => void
  setDocumentViewMode: (id: string, viewMode: ViewMode) => void
  markDocumentSaved: (id: string, options?: MarkDocumentSavedOptions) => void
  setLayoutJson: (layoutJson: unknown) => void
  setTheme: (theme: ThemePreference) => void
  setLocale: (locale: Locale | null) => void
  removeDocument: (id: string) => void
  resetWorkspace: () => void
  restoreSnapshot: (snapshot: WorkspaceSnapshot) => void
  toSnapshot: () => WorkspaceSnapshot
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions

const hasOwn = (documents: Record<string, WorkspaceDocument>, id: string) =>
  Object.prototype.hasOwnProperty.call(documents, id)

export function createWorkspaceStore() {
  return createStore<WorkspaceStore>()((set, get) => ({
    documents: {},
    documentOrder: [],
    activeDocumentId: null,
    theme: 'system',
    locale: null,

    addDocuments: (incomingDocuments) => {
      set((state) => {
        const documents = { ...state.documents }
        const documentOrder = [...state.documentOrder]

        for (const document of incomingDocuments) {
          if (hasOwn(documents, document.id)) continue
          documents[document.id] = document
          documentOrder.push(document.id)
        }

        return {
          documents,
          documentOrder,
          activeDocumentId: state.activeDocumentId ?? documentOrder[0] ?? null,
        }
      })
    },

    setActiveDocument: (id) => {
      set((state) => {
        if (id !== null && !hasOwn(state.documents, id)) return state
        return { activeDocumentId: id }
      })
    },

    updateDocumentText: (id, text, updatedAt = Date.now()) => {
      set((state) => {
        const document = state.documents[id]
        if (!document) return state

        return {
          documents: {
            ...state.documents,
            [id]: {
              ...document,
              text,
              dirty: text !== document.savedText,
              updatedAt,
            },
          },
        }
      })
    },

    setDocumentViewMode: (id, viewMode) => {
      set((state) => {
        const document = state.documents[id]
        if (!document) return state

        return {
          documents: {
            ...state.documents,
            [id]: { ...document, viewMode },
          },
        }
      })
    },

    markDocumentSaved: (id, options) => {
      set((state) => {
        const document = state.documents[id]
        if (!document) return state
        const savedText = options?.text ?? document.text

        return {
          documents: {
            ...state.documents,
            [id]: {
              ...document,
              savedText,
              dirty: document.text !== savedText,
              diskFingerprint: options?.fingerprint ?? document.diskFingerprint,
              updatedAt: options?.updatedAt ?? Date.now(),
            },
          },
        }
      })
    },

    setLayoutJson: (layoutJson) => {
      set({ layoutJson })
    },

    setTheme: (theme) => {
      set({ theme })
    },

    setLocale: (locale) => {
      set({ locale })
    },

    removeDocument: (id) => {
      set((state) => {
        if (!hasOwn(state.documents, id)) return state

        const removedIndex = state.documentOrder.indexOf(id)
        const documentOrder = state.documentOrder.filter((documentId) => documentId !== id)
        const documents = { ...state.documents }
        delete documents[id]

        let activeDocumentId = state.activeDocumentId
        if (activeDocumentId === id) {
          activeDocumentId =
            documentOrder[removedIndex] ?? documentOrder[removedIndex - 1] ?? null
        }

        return { documents, documentOrder, activeDocumentId }
      })
    },

    resetWorkspace: () => {
      set({
        documents: {},
        documentOrder: [],
        activeDocumentId: null,
        layoutJson: undefined,
        theme: 'system',
        locale: null,
      })
    },

    restoreSnapshot: (snapshot) => {
      const documents: Record<string, WorkspaceDocument> = {}
      const documentOrder: string[] = []

      for (const document of snapshot.documents) {
        if (hasOwn(documents, document.id)) continue
        documents[document.id] = document
        documentOrder.push(document.id)
      }

      set({
        documents,
        documentOrder,
        activeDocumentId:
          snapshot.activeDocumentId !== null && hasOwn(documents, snapshot.activeDocumentId)
            ? snapshot.activeDocumentId
            : null,
        layoutJson: snapshot.layoutJson,
        theme: snapshot.theme ?? 'system',
        locale: snapshot.locale ?? null,
      })
    },

    toSnapshot: () => {
      const state = get()
      return {
        schemaVersion: 1,
        documents: state.documentOrder.map((id) => state.documents[id]),
        activeDocumentId: state.activeDocumentId,
        ...(state.layoutJson === undefined ? {} : { layoutJson: state.layoutJson }),
        theme: state.theme,
        ...(state.locale === null ? {} : { locale: state.locale }),
      }
    },
  }))
}
