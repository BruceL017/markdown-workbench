import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Model } from 'flexlayout-react'
import { describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { WorkspaceDocument } from './domain/workspace'
import { AssetRegistry } from './files/assetRegistry'
import type { FileAdapter, OpenResult, SaveResult } from './files/fileAdapter'
import {
  InMemoryFileHandleRegistry,
  type FileHandleRegistry,
} from './files/nativeFileAdapter'
import { visibleDocumentIds } from './layout/workbenchLayout'
import { createWorkspaceStore } from './state/workspaceStore'
import type { WorkbenchRuntime } from './workbench/runtime'

function document(
  id: string,
  overrides: Partial<WorkspaceDocument> = {},
): WorkspaceDocument {
  return {
    id,
    name: `${id}.md`,
    virtualPath: `notes/${id}.md`,
    text: `# ${id}`,
    savedText: `# ${id}`,
    dirty: false,
    sourceKind: 'fallback',
    viewMode: 'preview',
    updatedAt: 1,
    ...overrides,
  }
}

function openResult(documents: WorkspaceDocument[]): OpenResult {
  return {
    documents,
    assetPaths: [],
    ignoredFiles: [],
    ignoredCount: 0,
  }
}

function adapter(overrides: Partial<FileAdapter> = {}): FileAdapter {
  return {
    capabilities: {
      openFiles: false,
      openDirectory: false,
      writeBack: false,
      download: true,
    },
    openFiles: vi.fn(async () => openResult([])),
    openDirectory: vi.fn(async () => openResult([])),
    save: vi.fn(async (): Promise<SaveResult> => ({
      status: 'downloaded',
      filename: 'document.md',
    })),
    requestWritePermission: vi.fn(async (): Promise<PermissionState> => 'denied'),
    ...overrides,
  }
}

function runtime(options: {
  documents?: WorkspaceDocument[]
  native?: FileAdapter
  fallback?: FileAdapter
  handleRegistry?: FileHandleRegistry
} = {}): WorkbenchRuntime {
  const store = createWorkspaceStore()
  store.getState().addDocuments(options.documents ?? [])

  const nativeHandleRegistry = options.handleRegistry ?? new InMemoryFileHandleRegistry()
  return {
    store,
    assetRegistry: new AssetRegistry({
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => undefined,
    }),
    nativeHandleRegistry,
    nativeAdapter: options.native ?? adapter(),
    fallbackAdapter: options.fallback ?? adapter(),
  }
}

function visibleIds(workbench: WorkbenchRuntime) {
  const json = workbench.store.getState().layoutJson
  if (!json) return []
  return visibleDocumentIds(Model.fromJson(json as Parameters<typeof Model.fromJson>[0]))
}

describe('App', () => {
  it('renders a local-first empty state and a temporary file drawer', async () => {
    const user = userEvent.setup()
    render(<App runtime={runtime()} />)

    expect(screen.getByRole('main', { name: 'Markdown Workbench' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Open local Markdown' })).toBeInTheDocument()
    expect(screen.getByText(/never uploaded/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByRole('dialog', { name: 'Local files' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close file drawer' }))
    expect(screen.queryByRole('dialog', { name: 'Local files' })).not.toBeInTheDocument()
  })

  it('opens a batch with only the first document visible and keeps the rest buffered', async () => {
    const user = userEvent.setup()
    const fallback = adapter({
      openFiles: vi.fn(async () => openResult([document('first'), document('second')])),
    })
    const workbench = runtime({ fallback })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Open files' }))

    expect(workbench.store.getState().documentOrder).toEqual(['first', 'second'])
    expect(visibleIds(workbench)).toEqual(['first'])
    const drawer = screen.getByRole('dialog', { name: 'Local files' })
    expect(within(drawer).getByRole('button', { name: 'Open second.md' })).toBeInTheDocument()

    await user.click(within(drawer).getByRole('button', { name: 'Open second.md' }))
    expect(visibleIds(workbench)).toEqual(['second'])
    expect(workbench.store.getState().activeDocumentId).toBe('second')
  })

  it('shows the first new document when a batch opens over an existing pane', async () => {
    const user = userEvent.setup()
    const fallback = adapter({
      openFiles: vi.fn(async () => openResult([document('new-first'), document('new-second')])),
    })
    const workbench = runtime({ documents: [document('old')], fallback })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'Open files' }))

    expect(workbench.store.getState().documentOrder).toEqual([
      'old',
      'new-first',
      'new-second',
    ])
    expect(visibleIds(workbench)).toEqual(['new-first'])
    expect(workbench.store.getState().activeDocumentId).toBe('new-first')
    expect(workbench.store.getState().documents.old).toBeDefined()
    expect(workbench.store.getState().documents['new-second']).toBeDefined()
  })

  it('preserves unrelated fallback files that share the same virtual path', async () => {
    const user = userEvent.setup()
    const fallback = adapter({
      openFiles: vi.fn(async () => openResult([
        document('first-copy', { name: 'notes.md', virtualPath: 'notes.md' }),
        document('second-copy', { name: 'notes.md', virtualPath: 'notes.md' }),
      ])),
    })
    const workbench = runtime({ fallback })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Open files' }))

    expect(workbench.store.getState().documentOrder).toEqual([
      'first-copy',
      'second-copy',
    ])
    expect(visibleIds(workbench)).toEqual(['first-copy'])
  })

  it('deduplicates a native file only when its handle proves the same entry', async () => {
    const user = userEvent.setup()
    const handles = new InMemoryFileHandleRegistry()
    const existingHandle = {
      kind: 'file',
      name: 'notes.md',
    } as unknown as FileSystemFileHandle
    const isSameEntry = vi.fn(async (other: FileSystemHandle) => other === existingHandle)
    const incomingHandle = {
      kind: 'file',
      name: 'notes.md',
      isSameEntry,
    } as unknown as FileSystemFileHandle
    handles.set('existing-handle', existingHandle)
    handles.set('incoming-handle', incomingHandle)
    const existing = document('existing-native', {
      name: 'notes.md',
      virtualPath: 'notes.md',
      sourceKind: 'native',
      handleKey: 'existing-handle',
    })
    const incoming = document('incoming-native', {
      name: 'notes.md',
      virtualPath: 'notes.md',
      sourceKind: 'native',
      handleKey: 'incoming-handle',
    })
    const native = adapter({
      capabilities: {
        openFiles: true,
        openDirectory: true,
        writeBack: true,
        download: false,
      },
      openFiles: vi.fn(async () => openResult([incoming])),
    })
    const workbench = runtime({ documents: [existing], native, handleRegistry: handles })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'Open files' }))

    expect(isSameEntry).toHaveBeenCalledWith(existingHandle)
    expect(workbench.store.getState().documentOrder).toEqual(['existing-native'])
    expect(visibleIds(workbench)).toEqual(['existing-native'])
    expect(handles.get('incoming-handle')).toBeUndefined()
  })

  it('splits buffered documents to every edge and focuses visible duplicates', async () => {
    const user = userEvent.setup()
    const workbench = runtime({ documents: [document('first'), document('second')] })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Files' }))
    const drawer = screen.getByRole('dialog', { name: 'Local files' })
    await user.click(
      within(drawer).getByRole('button', { name: 'Open second.md in right split' }),
    )

    expect(visibleIds(workbench)).toEqual(['first', 'second'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Files' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Files' }))
    const reopenedDrawer = screen.getByRole('dialog', { name: 'Local files' })
    await user.click(within(reopenedDrawer).getByRole('button', { name: 'Open first.md' }))

    expect(visibleIds(workbench)).toEqual(['first', 'second'])
    expect(workbench.store.getState().activeDocumentId).toBe('first')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Files' })).toHaveFocus())
  })

  it('does not move focus to Files for internal Markdown navigation', async () => {
    const user = userEvent.setup()
    const workbench = runtime({
      documents: [
        document('first', { text: '[Open second](second.md)' }),
        document('second'),
      ],
    })
    const previousWidth = globalThis.innerWidth
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 800 })
    try {
      render(<App runtime={workbench} />)

      await user.click(screen.getByRole('link', { name: 'Open second' }))

      expect(visibleIds(workbench)).toEqual(['second'])
      expect(screen.getByRole('button', { name: 'Files' })).not.toHaveFocus()
    } finally {
      Object.defineProperty(globalThis, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      })
    }
  })

  it('switches source and preview and exposes the dirty marker', async () => {
    const user = userEvent.setup()
    const workbench = runtime({ documents: [document('first')] })
    const previousWidth = globalThis.innerWidth
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 800 })
    try {
      render(<App runtime={workbench} />)

      expect(screen.getByRole('article', { name: 'Preview first.md' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Show source for first.md' }))
      expect(screen.getByRole('textbox', { name: 'Edit first.md' })).toBeInTheDocument()

      act(() => workbench.store.getState().updateDocumentText('first', '# edited'))
      expect(screen.getByLabelText('first.md has unsaved changes')).toBeInTheDocument()
    } finally {
      Object.defineProperty(globalThis, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      })
    }
  })

  it('requests native permission from Save, retries, and clears dirty state', async () => {
    const user = userEvent.setup()
    const save = vi
      .fn<FileAdapter['save']>()
      .mockResolvedValueOnce({ status: 'permission-required' })
      .mockResolvedValueOnce({
        status: 'written',
        fingerprint: { lastModified: 20, size: 8 },
      })
    const requestWritePermission = vi.fn(async () => 'granted' as const)
    const native = adapter({
      capabilities: {
        openFiles: true,
        openDirectory: true,
        writeBack: true,
        download: false,
      },
      save,
      requestWritePermission,
    })
    const workbench = runtime({
      documents: [
        document('first', {
          sourceKind: 'native',
          dirty: true,
          text: '# edited',
          handleKey: 'native:first',
        }),
      ],
      native,
    })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Save first.md' }))

    expect(requestWritePermission).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledTimes(2)
    expect(workbench.store.getState().documents.first).toMatchObject({
      dirty: false,
      savedText: '# edited',
      diskFingerprint: { lastModified: 20, size: 8 },
    })
  })

  it('resolves a disk conflict by reloading, downloading a copy, or overwriting', async () => {
    const user = userEvent.setup()
    const conflict: SaveResult = {
      status: 'conflict',
      diskText: '# disk',
      fingerprint: { lastModified: 30, size: 6 },
    }

    const reloadNative = adapter({
      save: vi.fn(async () => conflict),
    })
    const reloadWorkbench = runtime({
      documents: [document('reload', { sourceKind: 'native', text: '# draft', dirty: true })],
      native: reloadNative,
    })
    const reloadView = render(<App runtime={reloadWorkbench} />)
    const reloadOrigin = screen.getByRole('button', { name: 'Save reload.md' })
    await user.click(reloadOrigin)
    const reloadButton = screen.getByRole('button', { name: 'Reload disk version' })
    const downloadButton = screen.getByRole('button', { name: 'Download copy' })
    const overwriteButton = screen.getByRole('button', { name: 'Overwrite' })
    expect(reloadButton).toHaveFocus()
    await user.tab()
    expect(downloadButton).toHaveFocus()
    await user.tab()
    expect(overwriteButton).toHaveFocus()
    await user.tab()
    expect(reloadButton).toHaveFocus()
    await user.tab({ shift: true })
    expect(overwriteButton).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'reload.md changed on disk' }))
      .toBeInTheDocument()
    await user.click(reloadButton)
    expect(reloadWorkbench.store.getState().documents.reload).toMatchObject({
      text: '# disk',
      savedText: '# disk',
      dirty: false,
    })
    expect(visibleIds(reloadWorkbench)).toEqual(['reload'])
    await waitFor(() => expect(reloadOrigin).toHaveFocus())
    reloadView.unmount()

    const downloadNative = adapter({ save: vi.fn(async () => conflict) })
    const downloadFallback = adapter({
      save: vi.fn<FileAdapter['save']>().mockResolvedValue({
        status: 'downloaded',
        filename: 'download.md',
      }),
    })
    const downloadWorkbench = runtime({
      documents: [
        document('download', { sourceKind: 'native', text: '# draft', dirty: true }),
      ],
      native: downloadNative,
      fallback: downloadFallback,
    })
    const downloadView = render(<App runtime={downloadWorkbench} />)
    await user.click(screen.getByRole('button', { name: 'Save download.md' }))
    await user.click(screen.getByRole('button', { name: 'Download copy' }))
    expect(downloadFallback.save).toHaveBeenCalledOnce()
    expect(downloadWorkbench.store.getState().documents.download.dirty).toBe(false)
    downloadView.unmount()

    const overwriteSave = vi
      .fn<FileAdapter['save']>()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce({
        status: 'written',
        fingerprint: { lastModified: 31, size: 7 },
      })
    const overwriteWorkbench = runtime({
      documents: [
        document('overwrite', { sourceKind: 'native', text: '# draft', dirty: true }),
      ],
      native: adapter({ save: overwriteSave }),
    })
    render(<App runtime={overwriteWorkbench} />)
    await user.click(screen.getByRole('button', { name: 'Save overwrite.md' }))
    await user.click(screen.getByRole('button', { name: 'Overwrite' }))
    expect(overwriteSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'overwrite' }),
      { force: true },
    )
    expect(overwriteWorkbench.store.getState().documents.overwrite.dirty).toBe(false)
  })

  it('closes a save-requested pane after every successful conflict resolution', async () => {
    const user = userEvent.setup()
    const conflict: SaveResult = {
      status: 'conflict',
      diskText: '# disk',
      fingerprint: { lastModified: 40, size: 6 },
    }

    for (const resolution of ['Reload disk version', 'Download copy', 'Overwrite'] as const) {
      const id = resolution.split(' ')[0].toLowerCase()
      const nativeSave = resolution === 'Overwrite'
        ? vi.fn<FileAdapter['save']>()
            .mockResolvedValueOnce(conflict)
            .mockResolvedValueOnce({
              status: 'written',
              fingerprint: { lastModified: 41, size: 7 },
            })
        : vi.fn<FileAdapter['save']>().mockResolvedValue(conflict)
      const fallback = adapter({
        save: vi.fn<FileAdapter['save']>().mockResolvedValue({
          status: 'downloaded',
          filename: `${id}.md`,
        }),
      })
      const workbench = runtime({
        documents: [
          document(id, { sourceKind: 'native', text: '# draft', dirty: true }),
        ],
        native: adapter({ save: nativeSave }),
        fallback,
      })
      const view = render(<App runtime={workbench} />)

      await user.click(screen.getByRole('button', { name: `Close ${id}.md` }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getByRole('alertdialog', { name: `${id}.md changed on disk` }))
        .toBeInTheDocument()
      expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' }))
        .not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reload disk version' })).toHaveFocus()

      await user.click(screen.getByRole('button', { name: resolution }))

      expect(visibleIds(workbench)).toEqual([])
      expect(workbench.store.getState().documents[id]).toBeDefined()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Files' })).toHaveFocus())
      view.unmount()
    }
  })

  it('keeps the dirty pane when a forced conflict resolution fails', async () => {
    const user = userEvent.setup()
    const save = vi
      .fn<FileAdapter['save']>()
      .mockResolvedValueOnce({
        status: 'conflict',
        diskText: '# disk',
        fingerprint: { lastModified: 50, size: 6 },
      })
      .mockResolvedValueOnce({ status: 'permission-denied' })
    const workbench = runtime({
      documents: [
        document('denied', { sourceKind: 'native', text: '# draft', dirty: true }),
      ],
      native: adapter({ save }),
    })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Close denied.md' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Overwrite' }))

    expect(visibleIds(workbench)).toEqual(['denied'])
    expect(workbench.store.getState().documents.denied).toMatchObject({
      text: '# draft',
      dirty: true,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('permission was denied')
  })

  it('guards dirty pane closing with Cancel, Save, and Discard pane choices', async () => {
    const user = userEvent.setup()
    const fallback = adapter({
      save: vi.fn<FileAdapter['save']>().mockResolvedValue({
        status: 'downloaded',
        filename: 'first.md',
      }),
    })
    const workbench = runtime({
      documents: [document('first', { text: '# draft', dirty: true })],
      fallback,
    })
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Close first.md' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const discard = within(dialog).getByRole('button', { name: 'Discard pane' })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(discard).toHaveFocus()
    await user.tab()
    expect(save).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(save).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' }))
      .not.toBeInTheDocument()
    expect(visibleIds(workbench)).toEqual(['first'])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close first.md' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Close first.md' }))
    await user.click(screen.getByRole('button', { name: 'Discard pane' }))
    expect(visibleIds(workbench)).toEqual([])
    expect(workbench.store.getState().documents.first).toBeDefined()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Files' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'Open first.md' }))
    expect(visibleIds(workbench)).toEqual(['first'])
  })
})
