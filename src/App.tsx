import {
  ArrowLineDown,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowLineUp,
  FileMd,
  Files,
  FloppyDisk,
  FolderOpen,
  Gear,
  ShieldCheck,
  Trash,
  X,
} from '@phosphor-icons/react'
import {
  Layout,
  type Model,
  TabNode,
  type Action,
  type ILayoutApi,
  type ITabRenderValues,
} from 'flexlayout-react'
import 'flexlayout-react/style/combined.css'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { MarkdownEditor } from './editor/MarkdownEditor'
import type { DiskFingerprint, Locale, WorkspaceDocument } from './domain/workspace'
import type { OpenResult, SaveResult } from './files/fileAdapter'
import { normalizeWorkspacePath } from './files/virtualPath'
import {
  resolveLocale,
  translate,
  useWorkspaceLocale,
  WorkspaceLocaleProvider,
} from './i18n/workspaceLocale'
import {
  activeDocumentId,
  addDocumentSplit,
  createDocumentTabJson,
  createWorkbenchModel,
  documentIdForTab,
  focusDocument,
  isWorkbenchLayoutActionAllowed,
  paneIdForDocument,
  removeDocumentPane,
  replaceDocumentInPane,
  restoreWorkspaceModel,
  serializeWorkbenchLayout,
  type SplitDirection,
  visibleDocumentIds,
} from './layout/workbenchLayout'
import { DebouncedMarkdownPreview } from './markdown/DebouncedMarkdownPreview'
import { createWorkspaceSession, type WorkspaceSession } from './session/workspaceSession'
import { ClearLocalDataDialog, SettingsDialog } from './settings/PrivacySettings'
import { useWorkspaceTheme, type ResolvedTheme } from './theme/useWorkspaceTheme'
import { scrollToDocumentAnchor } from './workbench/previewNavigation'
import { createWorkbenchRuntime, type WorkbenchRuntime } from './workbench/runtime'
import { useModalFocus } from './workbench/useModalFocus'

interface AppProps {
  runtime?: WorkbenchRuntime
}

interface ConflictState {
  documentId: string
  diskText: string
  fingerprint: DiskFingerprint
}

type SaveOutcome = 'saved' | 'conflict' | 'failed'

type DocumentIntentKind = 'close-pane' | 'remove-workspace'

interface DocumentIntent {
  documentId: string
  kind: DocumentIntentKind
}

interface TransientNotice {
  id: number
  kind: 'status' | 'error'
  text: string
}

const splitActions: Array<{
  direction: SplitDirection
  icon: ReactNode
}> = [
  { direction: 'left', icon: <ArrowLineLeft aria-hidden /> },
  { direction: 'right', icon: <ArrowLineRight aria-hidden /> },
  { direction: 'top', icon: <ArrowLineUp aria-hidden /> },
  { direction: 'bottom', icon: <ArrowLineDown aria-hidden /> },
]

const splitDirectionMessages = {
  left: 'drawer.direction.left',
  right: 'drawer.direction.right',
  top: 'drawer.direction.top',
  bottom: 'drawer.direction.bottom',
} as const

export function App({ runtime: suppliedRuntime }: AppProps) {
  const [runtime] = useState(() => suppliedRuntime ?? createWorkbenchRuntime())
  const [sessionFailure, setSessionFailure] = useState<unknown>(null)
  const [session] = useState(() => createWorkspaceSession(runtime, {
    onError: setSessionFailure,
  }))
  const workspace = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getState,
    runtime.store.getState,
  )
  const [model, setModel] = useState<Model | null>(() => {
    if (runtime.persistence) return null
    const firstId = runtime.store.getState().documentOrder[0]
    const documents = runtime.store.getState().documentOrder.map(
      (id) => runtime.store.getState().documents[id],
    )
    return restoreWorkspaceModel(
      runtime.store.getState().layoutJson,
      documents,
      firstId ?? null,
    )
  })
  const resolvedTheme = useWorkspaceTheme(workspace.theme)
  const resolvedLocale = resolveLocale(workspace.locale)

  useEffect(() => {
    document.documentElement.lang = resolvedLocale
    document.title = translate(resolvedLocale, 'app.title')
  }, [resolvedLocale])

  useEffect(() => {
    if (model) {
      session.start()
      const flush = () => void session.flush().catch(() => undefined)
      const flushWhenHidden = () => {
        if (document.visibilityState === 'hidden') flush()
      }
      globalThis.addEventListener('pagehide', flush)
      document.addEventListener('visibilitychange', flushWhenHidden)
      return () => {
        globalThis.removeEventListener('pagehide', flush)
        document.removeEventListener('visibilitychange', flushWhenHidden)
        session.dispose()
      }
    }

    let active = true
    void session.hydrate().then(({ model: restoredModel }) => {
      if (active) setModel(restoredModel)
    })
    return () => {
      active = false
    }
  }, [model, session])

  if (!model) {
    return (
      <WorkspaceLocaleProvider locale={resolvedLocale}>
        <div className="bootstrap-state" role="status" aria-live="polite">
          {translate(resolvedLocale, 'app.restoring')}
        </div>
      </WorkspaceLocaleProvider>
    )
  }

  return (
    <WorkspaceLocaleProvider locale={resolvedLocale}>
      <WorkbenchApp
        runtime={runtime}
        model={model}
        session={session}
        resolvedTheme={resolvedTheme}
        sessionFailure={sessionFailure}
        onClearLocalData={async () => {
          await session.clear()
          setModel(createWorkbenchModel())
        }}
      />
    </WorkspaceLocaleProvider>
  )
}

function WorkbenchApp({
  runtime,
  model,
  session,
  resolvedTheme,
  sessionFailure,
  onClearLocalData,
}: {
  runtime: WorkbenchRuntime
  model: Model
  session: WorkspaceSession
  resolvedTheme: ResolvedTheme
  sessionFailure: unknown
  onClearLocalData: () => Promise<void>
}) {
  const { locale, t } = useWorkspaceLocale()
  const workspace = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getState,
    runtime.store.getState,
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'files' | 'folder' | null>(null)
  const [savingDocumentId, setSavingDocumentId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [documentRequest, setDocumentRequest] = useState<DocumentIntent | null>(null)
  const [afterSaveIntent, setAfterSaveIntent] = useState<DocumentIntent | null>(null)
  const [notice, setNotice] = useState<TransientNotice | null>(null)
  const [desktop, setDesktop] = useState(() => globalThis.innerWidth >= 1024)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clearConfirmation, setClearConfirmation] = useState(false)
  const [clearing, setClearing] = useState(false)
  const fileButtonRef = useRef<HTMLButtonElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const layoutRef = useRef<ILayoutApi>(null)
  const noticeSequence = useRef(0)
  const documentIntentOriginRef = useRef<HTMLElement | null>(null)

  const showNotice = useCallback((kind: TransientNotice['kind'], text: string) => {
    noticeSequence.current += 1
    setNotice({ id: noticeSequence.current, kind, text })
  }, [])

  const showStatus = useCallback((text: string) => showNotice('status', text), [showNotice])
  const showError = useCallback((text: string) => showNotice('error', text), [showNotice])

  useEffect(() => {
    if (!notice) return
    const timer = globalThis.setTimeout(
      () => setNotice((current) => current?.id === notice.id ? null : current),
      notice.kind === 'status' ? 3_000 : 6_000,
    )
    return () => globalThis.clearTimeout(timer)
  }, [notice])

  const syncLayout = useCallback(() => {
    if (
      runtime.store.getState().documentOrder.length === 0 &&
      visibleDocumentIds(model).length === 0
    ) {
      runtime.store.getState().setActiveDocument(null)
      return
    }
    runtime.store.getState().setLayoutJson(serializeWorkbenchLayout(model))
    runtime.store.getState().setActiveDocument(activeDocumentId(model))
  }, [model, runtime])

  useEffect(() => {
    syncLayout()
  }, [syncLayout])

  useEffect(() => {
    if (sessionFailure) {
      showError(messageForError(sessionFailure, t('error.recoverySave')))
    }
  }, [sessionFailure, showError, t])

  useEffect(() => {
    const onResize = () => setDesktop(globalThis.innerWidth >= 1024)
    globalThis.addEventListener('resize', onResize)
    return () => globalThis.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[aria-modal="true"]')) return
      setDrawerOpen(false)
      fileButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const hasDirtyDocuments = workspace.documentOrder.some(
    (id) => workspace.documents[id]?.dirty,
  )
  useEffect(() => {
    if (!hasDirtyDocuments) return
    const protectDrafts = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    globalThis.addEventListener('beforeunload', protectDrafts)
    return () => globalThis.removeEventListener('beforeunload', protectDrafts)
  }, [hasDirtyDocuments])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    globalThis.requestAnimationFrame?.(() => fileButtonRef.current?.focus())
  }, [])

  const showDocument = useCallback(
    (documentId: string, paneId?: string) => {
      const document = runtime.store.getState().documents[documentId]
      if (!document) return
      if (!focusDocument(model, documentId)) {
        replaceDocumentInPane(model, document, paneId)
      }
      syncLayout()
    },
    [model, runtime, syncLayout],
  )

  const splitDocument = useCallback(
    (documentId: string, direction: SplitDirection) => {
      const document = runtime.store.getState().documents[documentId]
      if (!document) return
      addDocumentSplit(model, document, direction)
      syncLayout()
    },
    [model, runtime, syncLayout],
  )

  const beginDocumentDrag = useCallback(
    (documentId: string, event: ReactDragEvent<HTMLButtonElement>) => {
      if (!desktop) {
        event.preventDefault()
        return
      }
      if (focusDocument(model, documentId)) {
        event.preventDefault()
        syncLayout()
        closeDrawer()
        return
      }

      const document = runtime.store.getState().documents[documentId]
      const layout = layoutRef.current
      if (!document || !layout) {
        event.preventDefault()
        return
      }

      event.dataTransfer.setData('text/plain', '--markdown-workbench-document--')
      event.dataTransfer.effectAllowed = 'copy'
      layout.addTabWithDragAndDrop(
        event.nativeEvent,
        createDocumentTabJson(document),
        (node) => {
          if (!(node instanceof TabNode)) return
          focusDocument(model, document.id)
          syncLayout()
          closeDrawer()
        },
      )
    },
    [closeDrawer, desktop, model, runtime, syncLayout],
  )

  const openLocal = useCallback(
    async (kind: 'files' | 'folder') => {
      setNotice(null)
      setBusyAction(kind)
      const capability = kind === 'files' ? 'openFiles' : 'openDirectory'
      const adapter = runtime.nativeAdapter.capabilities[capability]
        ? runtime.nativeAdapter
        : runtime.fallbackAdapter

      try {
        const result = kind === 'files'
          ? await adapter.openFiles()
          : await adapter.openDirectory()
        await acceptOpenResult(result)
      } catch (openError) {
        showError(messageForError(
          openError,
          kind === 'files' ? t('error.openFiles') : t('error.openFolder'),
        ))
      } finally {
        setBusyAction(null)
      }
    },
    [model, runtime, showError, syncLayout, t],
  )

  const acceptOpenResult = useCallback(
    async (result: OpenResult) => {
      if (result.documents.length === 0) return
      const current = runtime.store.getState()
      const knownDocuments = current.documentOrder.map((id) => current.documents[id])
      const openedDocuments: WorkspaceDocument[] = []
      const resultDocuments: WorkspaceDocument[] = []

      for (const incoming of result.documents) {
        const existing = await sameNativeDocument(
          incoming,
          knownDocuments,
          runtime.nativeHandleRegistry,
        )
        if (existing) {
          if (incoming.handleKey && incoming.handleKey !== existing.handleKey) {
            runtime.nativeHandleRegistry.delete(incoming.handleKey)
          }
          resultDocuments.push(existing)
          continue
        }
        knownDocuments.push(incoming)
        openedDocuments.push(incoming)
        resultDocuments.push(incoming)
      }

      await session.persistHandles(openedDocuments)
      runtime.store.getState().addDocuments(openedDocuments)
      const first = resultDocuments[0]
      if (first) {
        if (!focusDocument(model, first.id)) replaceDocumentInPane(model, first)
        syncLayout()
      }

      if (resultDocuments.length > 1) setDrawerOpen(true)
      showStatus(
        resultDocuments.length === 1
          ? t('status.openedOne', { name: resultDocuments[0].name })
          : t('status.openedMany', { count: resultDocuments.length }),
      )
    },
    [model, runtime, session, showStatus, syncLayout, t],
  )

  const performSave = useCallback(
    async (documentId: string, force = false): Promise<SaveOutcome> => {
      const document = runtime.store.getState().documents[documentId]
      if (!document) return 'failed'
      const adapter = document.sourceKind === 'native'
        ? runtime.nativeAdapter
        : runtime.fallbackAdapter
      setSavingDocumentId(documentId)
      setNotice(null)

      try {
        let result = await adapter.save(document, force ? { force: true } : undefined)
        if (result.status === 'permission-required') {
          const permission = await adapter.requestWritePermission(document)
          if (permission !== 'granted') {
            showError(t('error.writePermission'))
            return 'failed'
          }
          result = await adapter.save(document, force ? { force: true } : undefined)
        }

        return finishSave(document, result)
      } catch (saveError) {
        showError(messageForError(saveError, t('error.saveFailed')))
        return 'failed'
      } finally {
        setSavingDocumentId(null)
      }
    },
    [runtime, showError, t],
  )

  const finishSave = useCallback(
    (document: WorkspaceDocument, result: SaveResult): SaveOutcome => {
      if (result.status === 'conflict') {
        setConflict({
          documentId: document.id,
          diskText: result.diskText,
          fingerprint: result.fingerprint,
        })
        return 'conflict'
      }

      if (result.status === 'written') {
        runtime.store.getState().markDocumentSaved(document.id, {
          text: document.text,
          fingerprint: result.fingerprint,
        })
        setConflict(null)
        showStatus(t('status.savedOriginal', { name: document.name }))
        return 'saved'
      }

      if (result.status === 'downloaded') {
        runtime.store.getState().markDocumentSaved(document.id, { text: document.text })
        setConflict(null)
        showStatus(t('status.downloadStarted', { name: result.filename }))
        return 'saved'
      }

      const failureMessages: Record<
        Extract<SaveResult, { status: 'permission-denied' | 'permission-required' | 'unavailable' }>['status'],
        string
      > = {
        'permission-denied': t('error.permissionDenied'),
        'permission-required': t('error.permissionRequired'),
        unavailable: t('error.unavailable'),
      }
      showError(failureMessages[result.status])
      return 'failed'
    },
    [runtime, showError, showStatus, t],
  )

  const closePane = useCallback(
    (documentId: string) => {
      removeDocumentPane(model, documentId)
      syncLayout()
      setDocumentRequest(null)
      setAfterSaveIntent((pending) => pending?.documentId === documentId ? null : pending)
    },
    [model, syncLayout],
  )

  const removeFromWorkspace = useCallback(
    async (documentId: string) => {
      const state = runtime.store.getState()
      const removed = state.documents[documentId]
      if (!removed) return
      const ordered = sortWorkspaceDocuments(
        state.documentOrder.map((id) => state.documents[id]),
        locale,
      )
      const removedIndex = ordered.findIndex((document) => document.id === documentId)
      const replacement = ordered[removedIndex + 1] ?? ordered[removedIndex - 1]
      const paneId = paneIdForDocument(model, documentId)

      if (paneId) {
        if (!replacement) {
          removeDocumentPane(model, documentId)
        } else if (focusDocument(model, replacement.id)) {
          removeDocumentPane(model, documentId)
        } else {
          replaceDocumentInPane(model, replacement, paneId)
        }
      }

      runtime.store.getState().removeDocument(documentId)
      if (runtime.store.getState().documentOrder.length === 0) {
        runtime.assetRegistry.clear()
      }
      syncLayout()
      setDocumentRequest(null)
      setAfterSaveIntent((pending) => pending?.documentId === documentId ? null : pending)

      globalThis.requestAnimationFrame?.(() => focusDrawerAfterRemoval(replacement?.id))

      try {
        await session.forgetDocument(removed)
        showStatus(t('status.removed', { name: removed.name }))
      } catch {
        showError(t('error.removeCleanup'))
      }
    },
    [locale, model, runtime, session, showError, showStatus, syncLayout, t],
  )

  const completeIntent = useCallback(
    async (intent: DocumentIntent) => {
      if (intent.kind === 'close-pane') {
        closePane(intent.documentId)
      } else {
        await removeFromWorkspace(intent.documentId)
      }
    },
    [closePane, removeFromWorkspace],
  )

  const requestDocumentIntent = useCallback(
    (intent: DocumentIntent, origin?: HTMLElement) => {
      const document = runtime.store.getState().documents[intent.documentId]
      if (!document) return
      if (document.dirty) {
        documentIntentOriginRef.current = origin ?? null
        setDocumentRequest(intent)
      } else {
        void completeIntent(intent)
      }
    },
    [completeIntent, runtime],
  )

  const requestClosePane = useCallback(
    (documentId: string) => requestDocumentIntent({
      documentId,
      kind: 'close-pane',
    }),
    [requestDocumentIntent],
  )

  const requestRemoveDocument = useCallback(
    (documentId: string, origin: HTMLElement) => requestDocumentIntent({
      documentId,
      kind: 'remove-workspace',
    }, origin),
    [requestDocumentIntent],
  )

  const cancelDocumentIntent = useCallback(() => {
    const origin = documentRequest?.kind === 'remove-workspace'
      ? documentIntentOriginRef.current
      : null
    setDocumentRequest(null)
    if (origin) {
      globalThis.requestAnimationFrame?.(() => {
        if (origin.isConnected) origin.focus()
      })
    }
  }, [documentRequest])

  const saveAndCompleteIntent = useCallback(async () => {
    if (!documentRequest) return
    const intent = documentRequest
    setDocumentRequest(null)
    setAfterSaveIntent(intent)
    const outcome = await performSave(intent.documentId)
    if (outcome === 'saved') {
      if (!runtime.store.getState().documents[intent.documentId]?.dirty) {
        await completeIntent(intent)
      } else {
        setAfterSaveIntent((pending) =>
          pending?.documentId === intent.documentId ? null : pending)
      }
    } else if (outcome === 'failed') {
      setAfterSaveIntent((pending) => pending?.documentId === intent.documentId ? null : pending)
    }
  }, [completeIntent, documentRequest, performSave, runtime])

  const completeAfterSaveIntent = useCallback(
    async (documentId: string) => {
      if (afterSaveIntent?.documentId !== documentId) return
      const intent = afterSaveIntent
      setAfterSaveIntent(null)
      await completeIntent(intent)
    },
    [afterSaveIntent, completeIntent],
  )

  const reloadConflict = useCallback(() => {
    if (!conflict) return
    runtime.store.getState().updateDocumentText(conflict.documentId, conflict.diskText)
    runtime.store.getState().markDocumentSaved(conflict.documentId, {
      text: conflict.diskText,
      fingerprint: conflict.fingerprint,
    })
    const name = runtime.store.getState().documents[conflict.documentId]?.name
      ?? t('document.generic')
    showStatus(t('status.reloaded', { name }))
    setConflict(null)
    void completeAfterSaveIntent(conflict.documentId)
  }, [completeAfterSaveIntent, conflict, runtime, showStatus, t])

  const downloadConflictCopy = useCallback(async () => {
    if (!conflict) return
    const document = runtime.store.getState().documents[conflict.documentId]
    if (!document) return
    setSavingDocumentId(document.id)
    setNotice(null)
    try {
      const result = await runtime.fallbackAdapter.save(document)
      if (result.status === 'downloaded') {
        runtime.store.getState().markDocumentSaved(document.id, { text: document.text })
        showStatus(t('status.downloadStarted', { name: result.filename }))
        setConflict(null)
        await completeAfterSaveIntent(document.id)
      } else {
        showError(t('error.downloadStart'))
      }
    } catch (downloadError) {
      showError(messageForError(downloadError, t('error.downloadCopy')))
    } finally {
      setSavingDocumentId(null)
    }
  }, [completeAfterSaveIntent, conflict, runtime, showError, showStatus, t])

  const overwriteConflict = useCallback(async () => {
    if (!conflict) return
    const documentId = conflict.documentId
    const outcome = await performSave(documentId, true)
    if (outcome === 'saved') {
      await completeAfterSaveIntent(documentId)
    } else if (outcome === 'failed') {
      setConflict(null)
      setAfterSaveIntent((pending) => pending?.documentId === documentId ? null : pending)
    }
  }, [completeAfterSaveIntent, conflict, performSave])

  const openInternalDocument = useCallback(
    (path: string, currentDocumentId: string, hash?: string) => {
      const normalizedPath = normalizeWorkspacePath(path)
      const state = runtime.store.getState()
      const targetId = state.documentOrder.find(
        (id) => state.documents[id]?.virtualPath === normalizedPath,
      )
      if (!targetId) {
        showError(t('error.linkedDocument', { path: normalizedPath }))
        return
      }
      showDocument(targetId, paneIdForDocument(model, currentDocumentId))
      scrollToDocumentAnchor(targetId, hash)
    },
    [model, runtime, showDocument, showError, t],
  )

  const handleLayoutAction = useCallback((action: Action) => {
    return isWorkbenchLayoutActionAllowed(action) ? action : undefined
  }, [])

  const handleModelChange = useCallback(() => {
    syncLayout()
  }, [syncLayout])

  const renderTab = useCallback(
    (node: TabNode, renderValues: ITabRenderValues) => {
      const documentId = documentIdForTab(node)
      const document = documentId ? workspace.documents[documentId] : undefined
      if (!document) return

      renderValues.content = (
        <span className="pane-tab-title" title={document.virtualPath}>
          {document.dirty ? (
            <span
              className="dirty-dot"
              aria-label={t('document.dirty', { name: document.name })}
            />
          ) : null}
          <span className="pane-tab-name">{document.name}</span>
          <span className="pane-tab-path">{parentPath(document.virtualPath)}</span>
        </span>
      )
      renderValues.buttons = [
        <span className="pane-tab-actions" key={`actions-${document.id}`}>
          <span
            className="mode-switch"
            role="group"
            aria-label={t('document.view', { name: document.name })}
          >
            <button
              type="button"
              className={document.viewMode === 'source' ? 'is-active' : undefined}
              aria-label={t('document.showSource', { name: document.name })}
              aria-pressed={document.viewMode === 'source'}
              onClick={(event) => {
                stopTabEvent(event)
                runtime.store.getState().setDocumentViewMode(document.id, 'source')
              }}
            >
              {t('document.source')}
            </button>
            <button
              type="button"
              className={document.viewMode === 'preview' ? 'is-active' : undefined}
              aria-label={t('document.showPreview', { name: document.name })}
              aria-pressed={document.viewMode === 'preview'}
              onClick={(event) => {
                stopTabEvent(event)
                runtime.store.getState().setDocumentViewMode(document.id, 'preview')
              }}
            >
              {t('document.preview')}
            </button>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('document.save', { name: document.name })}
            title={t('document.saveTitle')}
            disabled={savingDocumentId === document.id}
            onClick={(event) => {
              stopTabEvent(event)
              void performSave(document.id)
            }}
          >
            <FloppyDisk aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('document.close', { name: document.name })}
            title={t('document.closeTitle')}
            onClick={(event) => {
              stopTabEvent(event)
              requestClosePane(document.id)
            }}
          >
            <X aria-hidden />
          </button>
        </span>,
      ]
    },
    [performSave, requestClosePane, runtime, savingDocumentId, t, workspace.documents],
  )

  const factory = useCallback(
    (node: TabNode) => {
      const documentId = documentIdForTab(node)
      const document = documentId ? workspace.documents[documentId] : undefined
      if (!document) return null
      return (
        <DocumentPane
          document={document}
          runtime={runtime}
          onSave={() => void performSave(document.id)}
          onOpenDocument={(path, hash) => openInternalDocument(path, document.id, hash)}
        />
      )
    },
    [openInternalDocument, performSave, runtime, workspace.documents],
  )

  const visibleIds = visibleDocumentIds(model).filter((id) => workspace.documents[id])
  const activeId = workspace.activeDocumentId && workspace.documents[workspace.activeDocumentId]
    ? workspace.activeDocumentId
    : visibleIds[0] ?? null
  const activeMobileDocument = activeId ? workspace.documents[activeId] : undefined
  const directSave = runtime.nativeAdapter.capabilities.writeBack
  const fileCountKey = workspace.documentOrder.length === 1
    ? 'files.countOne'
    : 'files.countMany'

  return (
    <main className="app-shell" aria-label={t('app.title')}>
      <a className="skip-link" href="#document-workspace">
        {t('app.skipWorkspace')}
      </a>
      <header className="topbar">
        <div className="brand-lockup">
          <FileMd size={20} weight="fill" aria-hidden />
          <span>{t('app.title')}</span>
        </div>
        <div className="topbar-actions">
          <span className="capability-label" title={directSave
            ? t('capability.directTitle')
            : t('capability.downloadTitle')}
          >
            <ShieldCheck aria-hidden />
            {directSave ? t('capability.direct') : t('capability.download')}
          </span>
          <div className="language-control" role="group" aria-label={t('language.label')}>
            <button
              type="button"
              aria-label={t('language.chinese')}
              aria-pressed={locale === 'zh-CN'}
              className={locale === 'zh-CN' ? 'is-active' : undefined}
              onClick={() => runtime.store.getState().setLocale('zh-CN' satisfies Locale)}
            >
              中
            </button>
            <button
              type="button"
              aria-label={t('language.english')}
              aria-pressed={locale === 'en'}
              className={locale === 'en' ? 'is-active' : undefined}
              onClick={() => runtime.store.getState().setLocale('en' satisfies Locale)}
            >
              EN
            </button>
          </div>
          <label className="theme-control">
            <span>{t('theme.label')}</span>
            <select
              aria-label={t('theme.label')}
              value={workspace.theme}
              onChange={(event) => runtime.store.getState().setTheme(
                event.currentTarget.value as 'system' | 'light' | 'dark',
              )}
            >
              <option value="system">{t('theme.system')}</option>
              <option value="light">{t('theme.light')}</option>
              <option value="dark">{t('theme.dark')}</option>
            </select>
          </label>
          <button
            ref={settingsButtonRef}
            type="button"
            className="icon-button"
            aria-label={t('settings.open')}
            title={t('settings.open')}
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <Gear aria-hidden />
          </button>
          <button
            ref={fileButtonRef}
            type="button"
            className="toolbar-button"
            aria-label={t('files.button')}
            aria-expanded={drawerOpen}
            aria-controls="file-drawer"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Files aria-hidden />
            <span className="files-button-label">{t('files.button')}</span>
            {workspace.documentOrder.length ? (
              <span
                className="file-count"
                aria-label={t(fileCountKey, { count: workspace.documentOrder.length })}
              >
                {workspace.documentOrder.length}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <section
        id="document-workspace"
        className="workspace-stage"
        aria-label={t('app.workspace')}
        tabIndex={-1}
      >
        {visibleIds.length === 0 ? (
          <EmptyWorkspace busyAction={busyAction} onOpen={openLocal} />
        ) : desktop ? (
          <div className={`workbench-layout flexlayout__theme_${resolvedTheme}`}>
            <Layout
              ref={layoutRef}
              model={model}
              factory={factory}
              onAction={handleLayoutAction}
              onModelChange={handleModelChange}
              onRenderTab={renderTab}
              realtimeResize
              supportsPopout={false}
              tabDragSpeed={0.12}
            />
          </div>
        ) : activeMobileDocument ? (
          <MobileDocument
            document={activeMobileDocument}
            runtime={runtime}
            saving={savingDocumentId === activeMobileDocument.id}
            onSave={() => void performSave(activeMobileDocument.id)}
            onClose={() => requestClosePane(activeMobileDocument.id)}
            onOpenDocument={(path, hash) =>
              openInternalDocument(path, activeMobileDocument.id, hash)}
          />
        ) : null}
      </section>

      {drawerOpen ? (
        <FileDrawer
          id="file-drawer"
          documents={workspace.documentOrder.map((id) => workspace.documents[id])}
          visibleDocumentIds={new Set(visibleIds)}
          activeDocumentId={activeId}
          busyAction={busyAction}
          nativeDirectory={runtime.nativeAdapter.capabilities.openDirectory}
          canSplit={desktop}
          onClose={closeDrawer}
          onOpen={openLocal}
          onSelect={(documentId) => {
            showDocument(documentId)
            closeDrawer()
          }}
          onSplit={(documentId, direction) => {
            splitDocument(documentId, direction)
            closeDrawer()
          }}
          onDragStart={beginDocumentDrag}
          onRemove={requestRemoveDocument}
        />
      ) : null}

      {notice ? (
        <div className="notice-region">
          <p
            className={`notice notice-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
          >
            {notice.text}
          </p>
        </div>
      ) : null}

      {conflict ? (
        <ConflictDialog
          documentName={workspace.documents[conflict.documentId]?.name ?? t('document.generic')}
          busy={savingDocumentId === conflict.documentId}
          onReload={reloadConflict}
          onDownload={() => void downloadConflictCopy()}
          onOverwrite={() => void overwriteConflict()}
          returnFocusRef={fileButtonRef}
        />
      ) : null}

      {documentRequest ? (
        <CloseGuardDialog
          documentName={workspace.documents[documentRequest.documentId]?.name ?? t('document.generic')}
          busy={savingDocumentId === documentRequest.documentId}
          intentKind={documentRequest.kind}
          onCancel={cancelDocumentIntent}
          onDiscard={() => void completeIntent(documentRequest)}
          onSave={() => void saveAndCompleteIntent()}
          returnFocusRef={fileButtonRef}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          directSave={directSave}
          onClose={() => setSettingsOpen(false)}
          onClear={() => {
            setSettingsOpen(false)
            setClearConfirmation(true)
          }}
          returnFocusRef={settingsButtonRef}
        />
      ) : null}

      {clearConfirmation ? (
        <ClearLocalDataDialog
          dirty={hasDirtyDocuments}
          busy={clearing}
          onCancel={() => setClearConfirmation(false)}
          onClear={async () => {
            setClearing(true)
            setNotice(null)
            try {
              await onClearLocalData()
              setClearConfirmation(false)
              showStatus(translate(
                resolveLocale(runtime.store.getState().locale),
                'status.cleared',
              ))
            } catch (clearError) {
              showError(messageForError(clearError, t('error.clear')))
            } finally {
              setClearing(false)
            }
          }}
          returnFocusRef={settingsButtonRef}
        />
      ) : null}
    </main>
  )
}

function EmptyWorkspace({
  busyAction,
  onOpen,
}: {
  busyAction: 'files' | 'folder' | null
  onOpen: (kind: 'files' | 'folder') => void
}) {
  const { t } = useWorkspaceLocale()

  return (
    <div className="empty-workspace">
      <div className="empty-icon" aria-hidden><FileMd weight="duotone" /></div>
      <h1>{t('empty.title')}</h1>
      <p>{t('empty.description')}</p>
      <div className="empty-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busyAction !== null}
          onClick={() => onOpen('files')}
        >
          <Files aria-hidden />
          {busyAction === 'files' ? t('empty.opening') : t('empty.openFiles')}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busyAction !== null}
          onClick={() => onOpen('folder')}
        >
          <FolderOpen aria-hidden />
          {busyAction === 'folder' ? t('empty.opening') : t('empty.openFolder')}
        </button>
      </div>
      <p className="privacy-note">{t('empty.privacy')}</p>
    </div>
  )
}

function FileDrawer({
  id,
  documents,
  visibleDocumentIds,
  activeDocumentId,
  busyAction,
  nativeDirectory,
  canSplit,
  onClose,
  onOpen,
  onSelect,
  onSplit,
  onDragStart,
  onRemove,
}: {
  id: string
  documents: WorkspaceDocument[]
  visibleDocumentIds: Set<string>
  activeDocumentId: string | null
  busyAction: 'files' | 'folder' | null
  nativeDirectory: boolean
  canSplit: boolean
  onClose: () => void
  onOpen: (kind: 'files' | 'folder') => void
  onSelect: (documentId: string) => void
  onSplit: (documentId: string, direction: SplitDirection) => void
  onDragStart: (
    documentId: string,
    event: ReactDragEvent<HTMLButtonElement>,
  ) => void
  onRemove: (documentId: string, origin: HTMLElement) => void
}) {
  const { locale, t } = useWorkspaceLocale()
  const [draggingDocumentId, setDraggingDocumentId] = useState<string | null>(null)
  const sortedDocuments = sortWorkspaceDocuments(documents, locale)

  return (
    <div className={`drawer-layer${draggingDocumentId ? ' is-dragging' : ''}`}>
      <button
        type="button"
        className="drawer-backdrop"
        aria-label={t('drawer.closeOverlay')}
        onClick={onClose}
      />
      <aside id={id} className="file-drawer" role="dialog" aria-modal="false" aria-labelledby="file-drawer-title">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">{t('drawer.eyebrow')}</p>
            <h2 id="file-drawer-title">{t('drawer.title')}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t('drawer.close')}
            autoFocus
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>

        <div className="drawer-open-actions">
          <button
            type="button"
            className="secondary-button"
            data-drawer-open-files
            disabled={busyAction !== null}
            onClick={() => onOpen('files')}
          >
            <Files aria-hidden /> {t('empty.openFiles')}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busyAction !== null}
            onClick={() => onOpen('folder')}
          >
            <FolderOpen aria-hidden /> {t('empty.openFolder')}
          </button>
        </div>
        <p className="drawer-capability">
          {nativeDirectory
            ? t('drawer.nativeCapability')
            : t('drawer.fallbackCapability')}
        </p>

        <div className="file-list-heading">
          <span>{t('drawer.section')}</span>
          <span>{documents.length}</span>
        </div>
        {sortedDocuments.length ? (
          <ul className="file-list">
            {sortedDocuments.map((document) => {
              const visible = visibleDocumentIds.has(document.id)
              return (
                <li
                  key={document.id}
                  data-file-document-id={document.id}
                  className={activeDocumentId === document.id ? 'is-active' : undefined}
                >
                  <button
                    type="button"
                    className="file-main-action"
                    aria-label={t('drawer.open', { name: document.name })}
                    aria-description={!visible && canSplit
                      ? t('drawer.dragDescription')
                      : undefined}
                    draggable={!visible && canSplit}
                    onDragStart={(event) => {
                      if (visible || !canSplit) return
                      setDraggingDocumentId(document.id)
                      onDragStart(document.id, event)
                    }}
                    onDragEnd={() => setDraggingDocumentId(null)}
                    onClick={() => onSelect(document.id)}
                  >
                    <FileMd aria-hidden />
                    <span>
                      <span className="file-name">
                        {document.name}
                        {document.dirty ? (
                          <span className="file-dirty" aria-label={t('drawer.unsaved')}>•</span>
                        ) : null}
                      </span>
                      <span className="file-path">{document.virtualPath}</span>
                    </span>
                    {visible ? <span className="visible-label">{t('drawer.visible')}</span> : null}
                  </button>
                  <div className="file-row-actions">
                    {canSplit ? (
                      <div
                        className="file-split-actions"
                        role="group"
                        aria-label={t('drawer.splitGroup', { name: document.name })}
                      >
                        {splitActions.map(({ direction, icon }) => {
                          const label = t(splitDirectionMessages[direction])
                          return (
                            <button
                              key={direction}
                              type="button"
                              className="icon-button"
                              aria-label={t('drawer.openSplit', {
                                name: document.name,
                                direction: label,
                              })}
                              title={t('drawer.openSplitTitle', { direction: label })}
                              disabled={visible}
                              onClick={() => onSplit(document.id, direction)}
                            >
                              {icon}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="icon-button file-remove-button"
                      aria-label={t('drawer.remove', { name: document.name })}
                      title={t('drawer.removeTitle')}
                      disabled={busyAction !== null}
                      onClick={(event) => onRemove(document.id, event.currentTarget)}
                    >
                      <Trash aria-hidden />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="drawer-empty">{t('drawer.empty')}</p>
        )}
        <footer className="drawer-footer">
          <ShieldCheck aria-hidden />
          {t('drawer.footer')}
        </footer>
      </aside>
    </div>
  )
}

function DocumentPane({
  document,
  runtime,
  onSave,
  onOpenDocument,
}: {
  document: WorkspaceDocument
  runtime: WorkbenchRuntime
  onSave: () => void
  onOpenDocument: (path: string, hash?: string) => void
}) {
  const { t } = useWorkspaceLocale()

  return (
    <div className="document-pane" data-workbench-document-pane={document.id}>
      {document.viewMode === 'source' ? (
        <MarkdownEditor
          value={document.text}
          ariaLabel={t('document.edit', { name: document.name })}
          onChange={(text) => runtime.store.getState().updateDocumentText(document.id, text)}
          onSave={onSave}
        />
      ) : (
        <div className="preview-scroll">
          <DebouncedMarkdownPreview
            documentKey={document.id}
            markdown={document.text}
            currentDocumentPath={document.virtualPath}
            assetRegistry={runtime.assetRegistry}
            ariaLabel={t('document.previewLabel', { name: document.name })}
            onOpenDocument={onOpenDocument}
          />
        </div>
      )}
    </div>
  )
}

function MobileDocument({
  document,
  runtime,
  saving,
  onSave,
  onClose,
  onOpenDocument,
}: {
  document: WorkspaceDocument
  runtime: WorkbenchRuntime
  saving: boolean
  onSave: () => void
  onClose: () => void
  onOpenDocument: (path: string, hash?: string) => void
}) {
  const { t } = useWorkspaceLocale()

  return (
    <section className="mobile-document" aria-label={document.name}>
      <header className="mobile-pane-header">
        <span className="mobile-title">
          {document.dirty ? (
            <span className="dirty-dot" aria-label={t('document.dirty', { name: document.name })} />
          ) : null}
          {document.name}
        </span>
        <span className="mode-switch" role="group" aria-label={t('document.view', { name: document.name })}>
          <button
            type="button"
            className={document.viewMode === 'source' ? 'is-active' : undefined}
            aria-label={t('document.showSource', { name: document.name })}
            aria-pressed={document.viewMode === 'source'}
            onClick={() => runtime.store.getState().setDocumentViewMode(document.id, 'source')}
          >{t('document.source')}</button>
          <button
            type="button"
            className={document.viewMode === 'preview' ? 'is-active' : undefined}
            aria-label={t('document.showPreview', { name: document.name })}
            aria-pressed={document.viewMode === 'preview'}
            onClick={() => runtime.store.getState().setDocumentViewMode(document.id, 'preview')}
          >{t('document.preview')}</button>
        </span>
        <button type="button" className="icon-button" aria-label={t('document.save', { name: document.name })} disabled={saving} onClick={onSave}>
          <FloppyDisk aria-hidden />
        </button>
        <button type="button" className="icon-button" aria-label={t('document.close', { name: document.name })} onClick={onClose}>
          <X aria-hidden />
        </button>
      </header>
      <div className="mobile-pane-content">
        <DocumentPane
          document={document}
          runtime={runtime}
          onSave={onSave}
          onOpenDocument={onOpenDocument}
        />
      </div>
    </section>
  )
}

function ConflictDialog({
  documentName,
  busy,
  onReload,
  onDownload,
  onOverwrite,
  returnFocusRef,
}: {
  documentName: string
  busy: boolean
  onReload: () => void
  onDownload: () => void
  onOverwrite: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const { t } = useWorkspaceLocale()
  useModalFocus(dialogRef, returnFocusRef)

  return (
    <div className="dialog-layer">
      <section ref={dialogRef} className="decision-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-description">
        <p className="eyebrow">{t('conflict.eyebrow')}</p>
        <h2 id="conflict-title">{t('conflict.title', { name: documentName })}</h2>
        <p id="conflict-description">{t('conflict.description')}</p>
        <div className="dialog-actions dialog-actions-stack">
          <button type="button" className="secondary-button" aria-label={t('conflict.reload')} autoFocus disabled={busy} onClick={onReload}>
            {t('conflict.reload')}
          </button>
          <button type="button" className="secondary-button" aria-label={t('conflict.download')} disabled={busy} onClick={onDownload}>
            {t('conflict.download')}
          </button>
          <button type="button" className="danger-button" aria-label={t('conflict.overwrite')} disabled={busy} onClick={onOverwrite}>
            {t('conflict.overwrite')}
          </button>
        </div>
      </section>
    </div>
  )
}

function CloseGuardDialog({
  documentName,
  busy,
  intentKind,
  onCancel,
  onDiscard,
  onSave,
  returnFocusRef,
}: {
  documentName: string
  busy: boolean
  intentKind: DocumentIntentKind
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const { t } = useWorkspaceLocale()
  useModalFocus(dialogRef, returnFocusRef, onCancel)
  const removing = intentKind === 'remove-workspace'

  return (
    <div className="dialog-layer">
      <section ref={dialogRef} className="decision-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-title" aria-describedby="close-description">
        <p className="eyebrow">{t('guard.eyebrow')}</p>
        <h2 id="close-title">{t('guard.title')}</h2>
        <p id="close-description">
          {t(removing ? 'guard.removeDescription' : 'guard.closeDescription', {
            name: documentName,
          })}
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onCancel}>
            {t('guard.cancel')}
          </button>
          <button type="button" className="danger-button" disabled={busy} onClick={onDiscard}>
            {t(removing ? 'guard.removeWithoutSaving' : 'guard.discardPane')}
          </button>
          <button type="button" className="primary-button" disabled={busy} onClick={onSave}>
            {busy
              ? t('guard.saving')
              : t(removing ? 'guard.saveAndRemove' : 'guard.save')}
          </button>
        </div>
      </section>
    </div>
  )
}

function sortWorkspaceDocuments(
  documents: WorkspaceDocument[],
  locale: Locale,
): WorkspaceDocument[] {
  const collator = new Intl.Collator(locale, { numeric: true })
  return [...documents].sort((left, right) =>
    collator.compare(left.virtualPath, right.virtualPath))
}

function focusDrawerAfterRemoval(documentId?: string) {
  const row = documentId
    ? Array.from(document.querySelectorAll<HTMLElement>('[data-file-document-id]'))
        .find((candidate) => candidate.dataset.fileDocumentId === documentId)
    : undefined
  const target = row?.querySelector<HTMLButtonElement>('.file-main-action')
    ?? document.querySelector<HTMLButtonElement>('[data-drawer-open-files]')
  target?.focus()
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function stopTabEvent(event: ReactMouseEvent<HTMLButtonElement>) {
  event.stopPropagation()
}

function messageForError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback
}

async function sameNativeDocument(
  incoming: WorkspaceDocument,
  candidates: WorkspaceDocument[],
  handles: WorkbenchRuntime['nativeHandleRegistry'],
): Promise<WorkspaceDocument | undefined> {
  if (incoming.sourceKind !== 'native' || !incoming.handleKey) return undefined
  const incomingHandle = handles.get(incoming.handleKey)
  if (!incomingHandle) return undefined

  for (const candidate of candidates) {
    if (candidate.sourceKind !== 'native' || !candidate.handleKey) continue
    const candidateHandle = handles.get(candidate.handleKey)
    if (!candidateHandle) continue
    try {
      if (await incomingHandle.isSameEntry(candidateHandle)) return candidate
    } catch {
      // If identity cannot be proven, preserve both documents.
    }
  }
  return undefined
}
