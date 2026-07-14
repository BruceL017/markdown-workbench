import {
  ArrowLineDown,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowLineUp,
  FileMd,
  Files,
  FloppyDisk,
  FolderOpen,
  ShieldCheck,
  X,
} from '@phosphor-icons/react'
import {
  Layout,
  TabNode,
  type Action,
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
  type ReactNode,
} from 'react'

import { MarkdownEditor } from './editor/MarkdownEditor'
import type { DiskFingerprint, WorkspaceDocument } from './domain/workspace'
import type { OpenResult, SaveResult } from './files/fileAdapter'
import { normalizeWorkspacePath } from './files/virtualPath'
import {
  activeDocumentId,
  addDocumentSplit,
  createWorkbenchModel,
  documentIdForTab,
  focusDocument,
  isWorkbenchLayoutActionAllowed,
  paneIdForDocument,
  removeDocumentPane,
  replaceDocumentInPane,
  serializeWorkbenchLayout,
  type SplitDirection,
  visibleDocumentIds,
} from './layout/workbenchLayout'
import { DebouncedMarkdownPreview } from './markdown/DebouncedMarkdownPreview'
import { scrollToDocumentAnchor } from './workbench/previewNavigation'
import { createWorkbenchRuntime, type WorkbenchRuntime } from './workbench/runtime'

interface AppProps {
  runtime?: WorkbenchRuntime
}

interface ConflictState {
  documentId: string
  diskText: string
  fingerprint: DiskFingerprint
}

const splitActions: Array<{
  direction: SplitDirection
  label: string
  icon: ReactNode
}> = [
  { direction: 'left', label: 'left', icon: <ArrowLineLeft aria-hidden /> },
  { direction: 'right', label: 'right', icon: <ArrowLineRight aria-hidden /> },
  { direction: 'top', label: 'top', icon: <ArrowLineUp aria-hidden /> },
  { direction: 'bottom', label: 'bottom', icon: <ArrowLineDown aria-hidden /> },
]

export function App({ runtime: suppliedRuntime }: AppProps) {
  const [runtime] = useState(() => suppliedRuntime ?? createWorkbenchRuntime())
  const workspace = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getState,
    runtime.store.getState,
  )
  const [model] = useState(() => {
    const firstId = runtime.store.getState().documentOrder[0]
    const first = firstId ? runtime.store.getState().documents[firstId] : undefined
    return createWorkbenchModel(first)
  })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'files' | 'folder' | null>(null)
  const [savingDocumentId, setSavingDocumentId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [closeRequest, setCloseRequest] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [desktop, setDesktop] = useState(() => globalThis.innerWidth >= 1024)
  const fileButtonRef = useRef<HTMLButtonElement>(null)

  const syncLayout = useCallback(() => {
    runtime.store.getState().setLayoutJson(serializeWorkbenchLayout(model))
    runtime.store.getState().setActiveDocument(activeDocumentId(model))
  }, [model, runtime])

  useEffect(() => {
    syncLayout()
  }, [syncLayout])

  useEffect(() => {
    const onResize = () => setDesktop(globalThis.innerWidth >= 1024)
    globalThis.addEventListener('resize', onResize)
    return () => globalThis.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
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
      setDrawerOpen(false)
    },
    [model, runtime, syncLayout],
  )

  const splitDocument = useCallback(
    (documentId: string, direction: SplitDirection) => {
      const document = runtime.store.getState().documents[documentId]
      if (!document) return
      addDocumentSplit(model, document, direction)
      syncLayout()
      setDrawerOpen(false)
    },
    [model, runtime, syncLayout],
  )

  const openLocal = useCallback(
    async (kind: 'files' | 'folder') => {
      setError('')
      setMessage('')
      setBusyAction(kind)
      const capability = kind === 'files' ? 'openFiles' : 'openDirectory'
      const adapter = runtime.nativeAdapter.capabilities[capability]
        ? runtime.nativeAdapter
        : runtime.fallbackAdapter

      try {
        const result = kind === 'files'
          ? await adapter.openFiles()
          : await adapter.openDirectory()
        acceptOpenResult(result)
      } catch (openError) {
        setError(messageForError(openError, `Could not open ${kind}.`))
      } finally {
        setBusyAction(null)
      }
    },
    [model, runtime, syncLayout],
  )

  const acceptOpenResult = useCallback(
    (result: OpenResult) => {
      if (result.documents.length === 0) return
      const current = runtime.store.getState()
      const existingByPath = new Map(
        current.documentOrder.map((id) => {
          const document = current.documents[id]
          return [documentKey(document), document] as const
        }),
      )
      const openedDocuments: WorkspaceDocument[] = []
      const resultDocuments: WorkspaceDocument[] = []

      for (const incoming of result.documents) {
        const existing = existingByPath.get(documentKey(incoming))
        if (existing) {
          resultDocuments.push(existing)
          continue
        }
        existingByPath.set(documentKey(incoming), incoming)
        openedDocuments.push(incoming)
        resultDocuments.push(incoming)
      }

      runtime.store.getState().addDocuments(openedDocuments)
      const first = resultDocuments[0]
      if (first) {
        if (!focusDocument(model, first.id)) replaceDocumentInPane(model, first)
        syncLayout()
      }

      if (resultDocuments.length > 1) setDrawerOpen(true)
      setMessage(
        resultDocuments.length === 1
          ? `Opened ${resultDocuments[0].name}.`
          : `Opened ${resultDocuments.length} Markdown files.`,
      )
    },
    [model, runtime, syncLayout],
  )

  const performSave = useCallback(
    async (documentId: string, force = false): Promise<boolean> => {
      const document = runtime.store.getState().documents[documentId]
      if (!document) return false
      const adapter = document.sourceKind === 'native'
        ? runtime.nativeAdapter
        : runtime.fallbackAdapter
      setSavingDocumentId(documentId)
      setError('')
      setMessage('')

      try {
        let result = await adapter.save(document, force ? { force: true } : undefined)
        if (result.status === 'permission-required') {
          const permission = await adapter.requestWritePermission(document)
          if (permission !== 'granted') {
            setError('Write permission was not granted. Your draft is still safe locally.')
            return false
          }
          result = await adapter.save(document, force ? { force: true } : undefined)
        }

        return finishSave(document, result)
      } catch (saveError) {
        setError(messageForError(saveError, 'Save failed. Your unsaved draft was kept.'))
        return false
      } finally {
        setSavingDocumentId(null)
      }
    },
    [runtime],
  )

  const finishSave = useCallback(
    (document: WorkspaceDocument, result: SaveResult): boolean => {
      if (result.status === 'conflict') {
        setConflict({
          documentId: document.id,
          diskText: result.diskText,
          fingerprint: result.fingerprint,
        })
        return false
      }

      if (result.status === 'written') {
        runtime.store.getState().markDocumentSaved(document.id, {
          text: document.text,
          fingerprint: result.fingerprint,
        })
        setConflict(null)
        setMessage(`Saved ${document.name} to the original file.`)
        return true
      }

      if (result.status === 'downloaded') {
        runtime.store.getState().markDocumentSaved(document.id, { text: document.text })
        setConflict(null)
        setMessage(`Download started for ${result.filename}.`)
        return true
      }

      const failureMessages: Record<
        Extract<SaveResult, { status: 'permission-denied' | 'permission-required' | 'unavailable' }>['status'],
        string
      > = {
        'permission-denied': 'Write permission was denied. Your draft is still safe locally.',
        'permission-required': 'Write permission is still required. Your draft was kept.',
        unavailable: 'The original file is unavailable. Your draft was kept.',
      }
      setError(failureMessages[result.status])
      return false
    },
    [runtime],
  )

  const closePane = useCallback(
    (documentId: string) => {
      removeDocumentPane(model, documentId)
      syncLayout()
      setCloseRequest(null)
    },
    [model, syncLayout],
  )

  const requestClosePane = useCallback(
    (documentId: string) => {
      const document = runtime.store.getState().documents[documentId]
      if (!document) return
      if (document.dirty) setCloseRequest(documentId)
      else closePane(documentId)
    },
    [closePane, runtime],
  )

  const saveAndClose = useCallback(async () => {
    if (!closeRequest) return
    const documentId = closeRequest
    setCloseRequest(null)
    const saved = await performSave(documentId)
    if (saved && !runtime.store.getState().documents[documentId]?.dirty) {
      closePane(documentId)
    }
  }, [closePane, closeRequest, performSave, runtime])

  const reloadConflict = useCallback(() => {
    if (!conflict) return
    runtime.store.getState().updateDocumentText(conflict.documentId, conflict.diskText)
    runtime.store.getState().markDocumentSaved(conflict.documentId, {
      text: conflict.diskText,
      fingerprint: conflict.fingerprint,
    })
    const name = runtime.store.getState().documents[conflict.documentId]?.name ?? 'document'
    setMessage(`Reloaded ${name} from disk.`)
    setConflict(null)
  }, [conflict, runtime])

  const downloadConflictCopy = useCallback(async () => {
    if (!conflict) return
    const document = runtime.store.getState().documents[conflict.documentId]
    if (!document) return
    setSavingDocumentId(document.id)
    setError('')
    try {
      const result = await runtime.fallbackAdapter.save(document)
      if (result.status === 'downloaded') {
        runtime.store.getState().markDocumentSaved(document.id, { text: document.text })
        setMessage(`Download started for ${result.filename}.`)
        setConflict(null)
      } else {
        setError('Could not start a download. Your draft was kept.')
      }
    } catch (downloadError) {
      setError(messageForError(downloadError, 'Could not download a copy. Your draft was kept.'))
    } finally {
      setSavingDocumentId(null)
    }
  }, [conflict, runtime])

  const openInternalDocument = useCallback(
    (path: string, currentDocumentId: string, hash?: string) => {
      const normalizedPath = normalizeWorkspacePath(path)
      const state = runtime.store.getState()
      const targetId = state.documentOrder.find(
        (id) => state.documents[id]?.virtualPath === normalizedPath,
      )
      if (!targetId) {
        setError(`Linked document is not open: ${normalizedPath}`)
        return
      }
      showDocument(targetId, paneIdForDocument(model, currentDocumentId))
      scrollToDocumentAnchor(targetId, hash)
    },
    [model, runtime, showDocument],
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
              aria-label={`${document.name} has unsaved changes`}
            />
          ) : null}
          <span className="pane-tab-name">{document.name}</span>
          <span className="pane-tab-path">{parentPath(document.virtualPath)}</span>
        </span>
      )
      renderValues.buttons = [
        <span className="pane-tab-actions" key={`actions-${document.id}`}>
          <span className="mode-switch" role="group" aria-label={`View ${document.name}`}>
            <button
              type="button"
              className={document.viewMode === 'source' ? 'is-active' : undefined}
              aria-label={`Show source for ${document.name}`}
              aria-pressed={document.viewMode === 'source'}
              onClick={(event) => {
                stopTabEvent(event)
                runtime.store.getState().setDocumentViewMode(document.id, 'source')
              }}
            >
              Source
            </button>
            <button
              type="button"
              className={document.viewMode === 'preview' ? 'is-active' : undefined}
              aria-label={`Show preview for ${document.name}`}
              aria-pressed={document.viewMode === 'preview'}
              onClick={(event) => {
                stopTabEvent(event)
                runtime.store.getState().setDocumentViewMode(document.id, 'preview')
              }}
            >
              Preview
            </button>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Save ${document.name}`}
            title="Save (⌘S / Ctrl+S)"
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
            aria-label={`Close ${document.name}`}
            title="Close pane"
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
    [performSave, requestClosePane, runtime, savingDocumentId, workspace.documents],
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

  return (
    <main className="app-shell" aria-label="Markdown Workbench">
      <header className="topbar">
        <div className="brand-lockup">
          <FileMd size={20} weight="fill" aria-hidden />
          <span>Markdown Workbench</span>
        </div>
        <div className="topbar-actions">
          <span className="capability-label" title={directSave
            ? 'This browser can save changes back to approved local files.'
            : 'This browser saves edited files by downloading a copy.'}
          >
            <ShieldCheck aria-hidden />
            {directSave ? 'Direct save' : 'Download save'}
          </span>
          <button
            ref={fileButtonRef}
            type="button"
            className="toolbar-button"
            aria-label="Files"
            aria-expanded={drawerOpen}
            aria-controls="file-drawer"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Files aria-hidden />
            Files
            {workspace.documentOrder.length ? (
              <span className="file-count" aria-label={`${workspace.documentOrder.length} files`}>
                {workspace.documentOrder.length}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <section className="workspace-stage" aria-label="Document workspace">
        {visibleIds.length === 0 ? (
          <EmptyWorkspace busyAction={busyAction} onOpen={openLocal} />
        ) : desktop ? (
          <div className="workbench-layout flexlayout__theme_light">
            <Layout
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
          onClose={closeDrawer}
          onOpen={openLocal}
          onSelect={showDocument}
          onSplit={splitDocument}
        />
      ) : null}

      <div className="live-region" aria-live="polite" aria-atomic="true">
        {message ? <p className="toast toast-status" role="status">{message}</p> : null}
        {error ? <p className="toast toast-error" role="alert">{error}</p> : null}
      </div>

      {conflict ? (
        <ConflictDialog
          documentName={workspace.documents[conflict.documentId]?.name ?? 'document'}
          busy={savingDocumentId === conflict.documentId}
          onReload={reloadConflict}
          onDownload={() => void downloadConflictCopy()}
          onOverwrite={() => {
            const documentId = conflict.documentId
            setConflict(null)
            void performSave(documentId, true)
          }}
        />
      ) : null}

      {closeRequest ? (
        <CloseGuardDialog
          documentName={workspace.documents[closeRequest]?.name ?? 'document'}
          busy={savingDocumentId === closeRequest}
          onCancel={() => setCloseRequest(null)}
          onDiscard={() => closePane(closeRequest)}
          onSave={() => void saveAndClose()}
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
  return (
    <div className="empty-workspace">
      <div className="empty-icon" aria-hidden><FileMd weight="duotone" /></div>
      <h1>Open local Markdown</h1>
      <p>
        Read, edit, and arrange private notes without sending document contents to a server.
      </p>
      <div className="empty-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busyAction !== null}
          onClick={() => onOpen('files')}
        >
          <Files aria-hidden />
          {busyAction === 'files' ? 'Opening…' : 'Open files'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busyAction !== null}
          onClick={() => onOpen('folder')}
        >
          <FolderOpen aria-hidden />
          {busyAction === 'folder' ? 'Opening…' : 'Open folder'}
        </button>
      </div>
      <p className="privacy-note">
        Files are read only in this browser and are never uploaded. Remote images in a document
        may still contact their third-party host.
      </p>
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
  onClose,
  onOpen,
  onSelect,
  onSplit,
}: {
  id: string
  documents: WorkspaceDocument[]
  visibleDocumentIds: Set<string>
  activeDocumentId: string | null
  busyAction: 'files' | 'folder' | null
  nativeDirectory: boolean
  onClose: () => void
  onOpen: (kind: 'files' | 'folder') => void
  onSelect: (documentId: string) => void
  onSplit: (documentId: string, direction: SplitDirection) => void
}) {
  const sortedDocuments = [...documents].sort((a, b) =>
    a.virtualPath.localeCompare(b.virtualPath, undefined, { numeric: true }),
  )

  return (
    <div className="drawer-layer">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="Close file drawer overlay"
        onClick={onClose}
      />
      <aside id={id} className="file-drawer" role="dialog" aria-modal="false" aria-labelledby="file-drawer-title">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="file-drawer-title">Local files</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close file drawer"
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
            disabled={busyAction !== null}
            onClick={() => onOpen('files')}
          >
            <Files aria-hidden /> Open files
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busyAction !== null}
            onClick={() => onOpen('folder')}
          >
            <FolderOpen aria-hidden /> Open folder
          </button>
        </div>
        <p className="drawer-capability">
          {nativeDirectory
            ? 'Folder access and approved file write-back are available.'
            : 'Compatibility mode: edits are saved by downloading a copy.'}
        </p>

        <div className="file-list-heading">
          <span>Markdown</span>
          <span>{documents.length}</span>
        </div>
        {sortedDocuments.length ? (
          <ul className="file-list">
            {sortedDocuments.map((document) => {
              const visible = visibleDocumentIds.has(document.id)
              return (
                <li key={document.id} className={activeDocumentId === document.id ? 'is-active' : undefined}>
                  <button
                    type="button"
                    className="file-main-action"
                    aria-label={`Open ${document.name}`}
                    onClick={() => onSelect(document.id)}
                  >
                    <FileMd aria-hidden />
                    <span>
                      <span className="file-name">
                        {document.name}
                        {document.dirty ? <span className="file-dirty" aria-label="Unsaved">•</span> : null}
                      </span>
                      <span className="file-path">{document.virtualPath}</span>
                    </span>
                    {visible ? <span className="visible-label">Visible</span> : null}
                  </button>
                  <div className="file-split-actions" role="group" aria-label={`Split ${document.name}`}>
                    {splitActions.map(({ direction, label, icon }) => (
                      <button
                        key={direction}
                        type="button"
                        className="icon-button"
                        aria-label={`Open ${document.name} in ${label} split`}
                        title={`Open in ${label} split`}
                        disabled={visible}
                        onClick={() => onSplit(document.id, direction)}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="drawer-empty">No Markdown files open.</p>
        )}
        <footer className="drawer-footer">
          <ShieldCheck aria-hidden />
          Document text stays on this device. No telemetry.
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
  return (
    <div className="document-pane" data-workbench-document-pane={document.id}>
      {document.viewMode === 'source' ? (
        <MarkdownEditor
          value={document.text}
          ariaLabel={`Edit ${document.name}`}
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
            ariaLabel={`Preview ${document.name}`}
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
  return (
    <section className="mobile-document" aria-label={document.name}>
      <header className="mobile-pane-header">
        <span className="mobile-title">
          {document.dirty ? <span className="dirty-dot" aria-label={`${document.name} has unsaved changes`} /> : null}
          {document.name}
        </span>
        <span className="mode-switch" role="group" aria-label={`View ${document.name}`}>
          <button
            type="button"
            className={document.viewMode === 'source' ? 'is-active' : undefined}
            aria-label={`Show source for ${document.name}`}
            aria-pressed={document.viewMode === 'source'}
            onClick={() => runtime.store.getState().setDocumentViewMode(document.id, 'source')}
          >Source</button>
          <button
            type="button"
            className={document.viewMode === 'preview' ? 'is-active' : undefined}
            aria-label={`Show preview for ${document.name}`}
            aria-pressed={document.viewMode === 'preview'}
            onClick={() => runtime.store.getState().setDocumentViewMode(document.id, 'preview')}
          >Preview</button>
        </span>
        <button type="button" className="icon-button" aria-label={`Save ${document.name}`} disabled={saving} onClick={onSave}>
          <FloppyDisk aria-hidden />
        </button>
        <button type="button" className="icon-button" aria-label={`Close ${document.name}`} onClick={onClose}>
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
}: {
  documentName: string
  busy: boolean
  onReload: () => void
  onDownload: () => void
  onOverwrite: () => void
}) {
  return (
    <div className="dialog-layer">
      <section className="decision-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-description">
        <p className="eyebrow">Save conflict</p>
        <h2 id="conflict-title">{documentName} changed on disk</h2>
        <p id="conflict-description">
          Choose which version to keep. Your browser draft remains available until an action succeeds.
        </p>
        <div className="dialog-actions dialog-actions-stack">
          <button type="button" className="secondary-button" aria-label="Reload disk version" autoFocus disabled={busy} onClick={onReload}>
            Reload disk version
          </button>
          <button type="button" className="secondary-button" aria-label="Download copy" disabled={busy} onClick={onDownload}>
            Download copy
          </button>
          <button type="button" className="danger-button" aria-label="Overwrite" disabled={busy} onClick={onOverwrite}>
            Overwrite
          </button>
        </div>
      </section>
    </div>
  )
}

function CloseGuardDialog({
  documentName,
  busy,
  onCancel,
  onDiscard,
  onSave,
}: {
  documentName: string
  busy: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <div className="dialog-layer">
      <section className="decision-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-title" aria-describedby="close-description">
        <p className="eyebrow">Unsaved draft</p>
        <h2 id="close-title">Unsaved changes</h2>
        <p id="close-description">Save {documentName} before closing this pane?</p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="danger-button" disabled={busy} onClick={onDiscard}>Discard pane</button>
          <button type="button" className="primary-button" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </section>
    </div>
  )
}

function documentKey(document: WorkspaceDocument): string {
  return `${document.sourceKind}:${document.virtualPath}`
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
