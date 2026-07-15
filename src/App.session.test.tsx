import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { WorkspaceDocument, WorkspaceSnapshot } from './domain/workspace'
import { AssetRegistry } from './files/assetRegistry'
import type { FileAdapter, OpenResult, SaveResult } from './files/fileAdapter'
import {
  InMemoryFileHandleRegistry,
  NativeFileAdapter,
} from './files/nativeFileAdapter'
import { createWorkbenchModel, serializeWorkbenchLayout } from './layout/workbenchLayout'
import type { WorkspacePersistence } from './persistence/indexedDbWorkspace'
import { createWorkspaceStore } from './state/workspaceStore'
import type { WorkbenchRuntime } from './workbench/runtime'

const initialWidth = globalThis.innerWidth

beforeEach(() => {
  Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 800 })
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: initialWidth })
})

function workspaceDocument(id: string, overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    id,
    name: `${id}.md`,
    virtualPath: `${id}.md`,
    text: `# ${id}`,
    savedText: `# ${id}`,
    dirty: false,
    sourceKind: 'fallback',
    viewMode: 'preview',
    updatedAt: 1,
    ...overrides,
  }
}

function emptyOpenResult(): OpenResult {
  return { documents: [], assetPaths: [], ignoredFiles: [], ignoredCount: 0 }
}

function adapter(overrides: Partial<FileAdapter> = {}): FileAdapter {
  return {
    capabilities: {
      openFiles: false,
      openDirectory: false,
      writeBack: false,
      download: true,
    },
    openFiles: vi.fn(async () => emptyOpenResult()),
    openDirectory: vi.fn(async () => emptyOpenResult()),
    save: vi.fn(async (): Promise<SaveResult> => ({
      status: 'downloaded',
      filename: 'document.md',
    })),
    requestWritePermission: vi.fn(async () => 'denied' as const),
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

function runtime(options: {
  documents?: WorkspaceDocument[]
  persistence?: WorkspacePersistence
  native?: FileAdapter
  fallback?: FileAdapter
} = {}): WorkbenchRuntime {
  const nativeHandleRegistry = new InMemoryFileHandleRegistry()
  const store = createWorkspaceStore()
  store.getState().addDocuments(options.documents ?? [])
  return {
    store,
    assetRegistry: new AssetRegistry({
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => undefined,
    }),
    nativeHandleRegistry,
    nativeAdapter: options.native ?? adapter(),
    fallbackAdapter: options.fallback ?? adapter(),
    persistence: options.persistence,
  }
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  const restored = workspaceDocument('restored', {
    text: '# recovered draft',
    savedText: '# disk',
    dirty: true,
    viewMode: 'source',
  })
  return {
    schemaVersion: 1,
    documents: [restored],
    activeDocumentId: restored.id,
    layoutJson: serializeWorkbenchLayout(createWorkbenchModel(restored)),
    theme: 'dark',
    ...overrides,
  }
}

describe('App session lifecycle', () => {
  it('shows a bootstrap status and restores a dirty draft before rendering the workbench', async () => {
    let finish!: (snapshot: WorkspaceSnapshot) => void
    const loadWorkspace = vi.fn(
      () => new Promise<WorkspaceSnapshot>((resolve) => { finish = resolve }),
    )
    const workbench = runtime({ persistence: persistence({ loadWorkspace }) })
    render(<App runtime={workbench} />)

    expect(screen.getByRole('status')).toHaveTextContent('Restoring local workspace')
    expect(screen.queryByRole('main', { name: 'Markdown Workbench' })).not.toBeInTheDocument()

    act(() => finish(snapshot()))

    expect(await screen.findByRole('textbox', { name: 'Edit restored.md' })).toBeInTheDocument()
    expect(workbench.store.getState().documents.restored).toMatchObject({
      text: '# recovered draft',
      savedText: '# disk',
      dirty: true,
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('restores and persists the interface language without changing the schema version', async () => {
    const user = userEvent.setup()
    const saveWorkspace = vi.fn(async () => undefined)
    const workbench = runtime({
      persistence: persistence({
        loadWorkspace: vi.fn(async () => snapshot({ locale: 'zh-CN' })),
        saveWorkspace,
      }),
    })
    render(<App runtime={workbench} />)

    await screen.findByRole('textbox', { name: '编辑 restored.md' })
    expect(screen.getByRole('main', { name: 'Markdown 工作台' })).toBeInTheDocument()
    expect(workbench.store.getState().locale).toBe('zh-CN')

    await user.click(screen.getByRole('button', { name: '英文' }))

    expect(workbench.store.getState().locale).toBe('en')
    await waitFor(() => expect(saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1, locale: 'en' }),
    ), { timeout: 1_500 })
  })

  it('persists accepted native handles and requests permission only from Save', async () => {
    const user = userEvent.setup()
    const handle = {
      kind: 'file',
      name: 'native.md',
      isSameEntry: vi.fn(async () => false),
    } as unknown as FileSystemFileHandle
    const opened = workspaceDocument('native', {
      sourceKind: 'native',
      handleKey: 'native:key',
      dirty: true,
    })
    const save = vi.fn<FileAdapter['save']>()
      .mockResolvedValueOnce({ status: 'permission-required' })
      .mockResolvedValueOnce({
        status: 'written',
        fingerprint: { lastModified: 2, size: 8 },
      })
    const requestWritePermission = vi.fn(async () => 'granted' as const)
    const native = adapter({
      capabilities: {
        openFiles: true,
        openDirectory: true,
        writeBack: true,
        download: false,
      },
      openFiles: vi.fn(async () => {
        workbench.nativeHandleRegistry.set('native:key', handle)
        return { ...emptyOpenResult(), documents: [opened] }
      }),
      save,
      requestWritePermission,
    })
    const saveHandle = vi.fn(async () => undefined)
    const workbench = runtime({ persistence: persistence({ saveHandle }), native })
    render(<App runtime={workbench} />)
    await screen.findByRole('heading', { name: 'Open local Markdown' })

    await user.click(screen.getByRole('button', { name: 'Open files' }))
    expect(saveHandle).toHaveBeenCalledWith('native:key', handle)
    expect(requestWritePermission).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save native.md' }))
    expect(requestWritePermission).toHaveBeenCalledOnce()
  })

  it('writes an edited document through the real native adapter after explicit permission', async () => {
    const user = userEvent.setup()
    const assetRegistry = new AssetRegistry({
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => undefined,
    })
    const handleRegistry = new InMemoryFileHandleRegistry()
    let permission: PermissionState = 'prompt'
    let diskText = '# Original'
    let lastModified = 1
    let pendingText = diskText
    const requestPermission = vi.fn(async () => {
      permission = 'granted'
      return permission
    })
    const handle = {
      kind: 'file',
      name: 'native.md',
      queryPermission: vi.fn(async () => permission),
      requestPermission,
      getFile: vi.fn(async () => new File([diskText], 'native.md', { lastModified })),
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (text: string) => { pendingText = text }),
        close: vi.fn(async () => {
          diskText = pendingText
          lastModified += 1
        }),
        abort: vi.fn(async () => undefined),
      })),
      isSameEntry: vi.fn(async () => false),
    } as unknown as FileSystemFileHandle
    const nativeAdapter = new NativeFileAdapter({
      assetRegistry,
      handleRegistry,
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(async () => [handle]),
      },
      createId: () => 'native-real',
      createHandleKey: () => 'native-real:key',
      now: () => 2,
    })
    const workbench: WorkbenchRuntime = {
      store: createWorkspaceStore(),
      assetRegistry,
      nativeHandleRegistry: handleRegistry,
      nativeAdapter,
      fallbackAdapter: adapter(),
    }
    render(<App runtime={workbench} />)

    await user.click(screen.getByRole('button', { name: 'Open files' }))
    act(() => workbench.store.getState().updateDocumentText('native-real', '# Edited locally'))
    await user.click(screen.getByRole('button', { name: 'Save native.md' }))

    await waitFor(() => expect(diskText).toBe('# Edited locally'))
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(workbench.store.getState().documents['native-real']).toMatchObject({
      savedText: '# Edited locally',
      dirty: false,
      diskFingerprint: { lastModified: 2, size: 16 },
    })
  })

  it('keeps desktop layout unchanged at 1023px and restores split affordances at 1024px', async () => {
    const user = userEvent.setup()
    const one = workspaceDocument('one')
    const two = workspaceDocument('two')
    const model = createWorkbenchModel(one)
    const layoutBefore = serializeWorkbenchLayout(model)
    const workbench = runtime({
      persistence: persistence({
        loadWorkspace: vi.fn(async () => snapshot({
          documents: [one, two],
          activeDocumentId: 'one',
          layoutJson: layoutBefore,
          theme: 'system',
        })),
      }),
    })
    const originalWidth = globalThis.innerWidth
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1023 })
    try {
      render(<App runtime={workbench} />)
      await screen.findByRole('article', { name: 'Preview one.md' })
      await user.click(screen.getByRole('button', { name: 'Files' }))
      expect(screen.queryByRole('group', { name: 'Split two.md' })).not.toBeInTheDocument()
      const jsonAtMobile = workbench.store.getState().layoutJson

      act(() => {
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1024 })
        globalThis.dispatchEvent(new Event('resize'))
      })
      await waitFor(() => expect(screen.getByRole('group', { name: 'Split two.md' })).toBeInTheDocument())
      expect(workbench.store.getState().layoutJson).toEqual(jsonAtMobile)
    } finally {
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('persists theme choice and clears local data only after explicit confirmation', async () => {
    const user = userEvent.setup()
    const clear = vi.fn(async () => undefined)
    const workbench = runtime({
      persistence: persistence({
        loadWorkspace: vi.fn(async () => snapshot()),
        clear,
      }),
    })
    render(<App runtime={workbench} />)
    await screen.findByRole('textbox', { name: 'Edit restored.md' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light')
    expect(workbench.store.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Privacy and local data' }))
    const settings = screen.getByRole('dialog', { name: 'Privacy and local data' })
    expect(within(settings).getByText(/No document upload or telemetry/i)).toBeInTheDocument()
    await user.click(within(settings).getByRole('button', { name: 'Clear local data' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Clear local data?' })
    expect(confirmation).toHaveTextContent('unsaved')
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(clear).not.toHaveBeenCalled()
    expect(workbench.store.getState().documents.restored).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Privacy and local data' }))
    await user.click(screen.getByRole('button', { name: 'Clear local data' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Clear local data?' }))
      .getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(clear).toHaveBeenCalledOnce())
    expect(workbench.store.getState().documentOrder).toEqual([])
    expect(screen.getByRole('heading', { name: 'Open local Markdown' })).toBeInTheDocument()
  })

  it('registers the page-leave guard only while a dirty document exists', () => {
    const clean = workspaceDocument('clean')
    const workbench = runtime({ documents: [clean] })
    render(<App runtime={workbench} />)

    const cleanEvent = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)

    act(() => workbench.store.getState().updateDocumentText('clean', '# dirty'))
    const dirtyEvent = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)

    act(() => workbench.store.getState().markDocumentSaved('clean'))
    const savedEvent = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(savedEvent)
    expect(savedEvent.defaultPrevented).toBe(false)
  })

  it('surfaces a retryable local persistence failure without dropping the draft', async () => {
    const saveWorkspace = vi.fn()
      .mockRejectedValueOnce(new Error('quota full'))
      .mockResolvedValueOnce(undefined)
    const workbench = runtime({ persistence: persistence({ saveWorkspace }) })
    render(<App runtime={workbench} />)
    await screen.findByRole('heading', { name: 'Open local Markdown' })
    vi.useFakeTimers()

    act(() => workbench.store.getState().addDocuments([workspaceDocument('draft')]))
    await act(async () => vi.advanceTimersByTimeAsync(750))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Local recovery data could not be saved. quota full',
    )
    expect(workbench.store.getState().documents.draft.text).toBe('# draft')
  })

  it('keeps clear confirmation modal while destructive cleanup is in flight', async () => {
    const user = userEvent.setup()
    let finishClear!: () => void
    const clear = vi.fn(
      () => new Promise<void>((resolve) => { finishClear = resolve }),
    )
    const workbench = runtime({
      persistence: persistence({
        loadWorkspace: vi.fn(async () => snapshot()),
        clear,
      }),
    })
    render(<App runtime={workbench} />)
    await screen.findByRole('textbox', { name: 'Edit restored.md' })
    await user.click(screen.getByRole('button', { name: 'Privacy and local data' }))
    await user.click(screen.getByRole('button', { name: 'Clear local data' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    const confirmation = screen.getByRole('alertdialog', { name: 'Clear local data?' })
    expect(screen.getByRole('button', { name: 'Clearing…' })).toBeDisabled()
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(confirmation, { key: 'Escape' })
    expect(confirmation).toBeInTheDocument()

    finishClear()
    await waitFor(() => expect(screen.queryByRole('alertdialog', {
      name: 'Clear local data?',
    })).not.toBeInTheDocument())
    expect(workbench.store.getState().documentOrder).toEqual([])
  })
})
