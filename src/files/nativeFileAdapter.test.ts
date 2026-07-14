import { describe, expect, it, vi } from 'vitest'

import { AssetRegistry } from './assetRegistry'
import {
  InMemoryFileHandleRegistry,
  NativeFileAdapter,
  getNativeFileAdapterCapabilities,
} from './nativeFileAdapter'

class FakeFileHandle {
  readonly kind = 'file' as const
  readonly isFile = true as const
  readonly isDirectory = false as const
  permission: PermissionState = 'granted'
  requestPermissionCalls = 0
  writes: string[] = []
  abortCalls = 0
  writeFailure?: Error
  closeFailure?: Error
  abortFailure?: Error

  constructor(
    readonly name: string,
    private file: File,
  ) {}

  getFile() {
    return Promise.resolve(this.file)
  }

  replaceExternally(text: string, lastModified: number) {
    this.file = new File([text], this.name, { type: 'text/markdown', lastModified })
  }

  queryPermission() {
    return Promise.resolve(this.permission)
  }

  requestPermission() {
    this.requestPermissionCalls += 1
    this.permission = 'granted'
    return Promise.resolve(this.permission)
  }

  async createWritable() {
    let nextText = ''

    return {
      write: async (text: string) => {
        if (this.writeFailure) throw this.writeFailure
        nextText = text
        this.writes.push(text)
      },
      close: async () => {
        if (this.closeFailure) throw this.closeFailure
        this.file = new File([nextText], this.name, {
          type: 'text/markdown',
          lastModified: this.file.lastModified + 1,
        })
      },
      abort: async () => {
        this.abortCalls += 1
        if (this.abortFailure) throw this.abortFailure
      },
    }
  }
}

interface FakeDirectory {
  kind: 'directory'
  name: string
  entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectory]>
}

function fakeDirectory(
  name: string,
  entries: Array<[string, FakeFileHandle | FakeDirectory]>,
): FakeDirectory {
  return {
    kind: 'directory' as const,
    name,
    async *entries() {
      yield* entries
    },
  }
}

function createRegistry() {
  return new AssetRegistry({
    createObjectURL: vi.fn(() => 'blob:asset'),
    revokeObjectURL: vi.fn(),
  })
}

describe('native file adapter', () => {
  it('only reports picker support in a secure context with the matching APIs', () => {
    expect(
      getNativeFileAdapterCapabilities({
        isSecureContext: true,
        showOpenFilePicker: vi.fn(),
        showDirectoryPicker: vi.fn(),
      }),
    ).toEqual({ openFiles: true, openDirectory: true, writeBack: true, download: false })

    expect(
      getNativeFileAdapterCapabilities({
        isSecureContext: false,
        showOpenFilePicker: vi.fn(),
        showDirectoryPicker: vi.fn(),
      }),
    ).toEqual({ openFiles: false, openDirectory: false, writeBack: false, download: false })

    expect(
      getNativeFileAdapterCapabilities({
        isSecureContext: true,
        showDirectoryPicker: vi.fn(),
      }),
    ).toEqual({ openFiles: false, openDirectory: true, writeBack: true, download: false })
  })

  it('limits the multi-file picker to Markdown and reports ignored files', async () => {
    const markdown = new FakeFileHandle(
      'notes.md',
      new File(['hello'], 'notes.md', { type: 'text/markdown', lastModified: 11 }),
    )
    const ignored = new FakeFileHandle(
      'notes.txt',
      new File(['not markdown'], 'notes.txt', { type: 'text/plain', lastModified: 12 }),
    )
    const showOpenFilePicker = vi.fn(async () => [markdown, ignored] as unknown as FileSystemFileHandle[])
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      environment: {
        isSecureContext: true,
        showOpenFilePicker,
        showDirectoryPicker: vi.fn(),
      },
      createId: () => 'document-1',
      createHandleKey: () => 'handle-1',
      now: () => 100,
    })

    const result = await adapter.openFiles()

    expect(showOpenFilePicker).toHaveBeenCalledWith({
      multiple: true,
      excludeAcceptAllOption: true,
      types: [
        {
          description: 'Markdown',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        },
      ],
    })
    expect(result.documents).toEqual([
      expect.objectContaining({
        id: 'document-1',
        name: 'notes.md',
        virtualPath: 'notes.md',
        text: 'hello',
        savedText: 'hello',
        dirty: false,
        sourceKind: 'native',
        viewMode: 'preview',
        updatedAt: 100,
        diskFingerprint: { lastModified: 11, size: 5 },
        handleKey: 'handle-1',
      }),
    ])
    expect(result.ignoredFiles).toEqual([{ name: 'notes.txt', virtualPath: 'notes.txt' }])
    expect(result.ignoredCount).toBe(1)
    expect(result.assetPaths).toEqual(['notes.txt'])
  })

  it('returns an empty result when the user cancels a picker', async () => {
    const abort = new DOMException('cancelled', 'AbortError')
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(async () => {
          throw abort
        }),
        showDirectoryPicker: vi.fn(),
      },
    })

    await expect(adapter.openFiles()).resolves.toEqual({
      documents: [],
      assetPaths: [],
      ignoredFiles: [],
      ignoredCount: 0,
    })
  })

  it('returns an empty directory result only for cancellation', async () => {
    const failure = new Error('directory failed')
    const showDirectoryPicker = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
      .mockRejectedValueOnce(failure)
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(),
        showDirectoryPicker,
      },
    })

    await expect(adapter.openDirectory()).resolves.toEqual({
      documents: [],
      assetPaths: [],
      ignoredFiles: [],
      ignoredCount: 0,
    })
    await expect(adapter.openDirectory()).rejects.toBe(failure)
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('walks directories recursively using workspace-root-relative paths', async () => {
    const markdown = new FakeFileHandle(
      'guide.markdown',
      new File(['guide'], 'guide.markdown', { type: 'text/markdown', lastModified: 1 }),
    )
    const image = new FakeFileHandle(
      'cover.png',
      new File(['image'], 'cover.png', { type: 'image/png', lastModified: 2 }),
    )
    const selectedDirectory = fakeDirectory('project', [
      ['docs', fakeDirectory('docs', [['guide.markdown', markdown]])],
      ['images', fakeDirectory('images', [['cover.png', image]])],
    ])
    const registry = createRegistry()
    const showDirectoryPicker = vi.fn(
      async () => selectedDirectory as unknown as FileSystemDirectoryHandle,
    )
    const adapter = new NativeFileAdapter({
      assetRegistry: registry,
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(),
        showDirectoryPicker,
      },
      createId: () => 'guide-id',
      createHandleKey: () => 'guide-handle',
      now: () => 10,
    })

    const result = await adapter.openDirectory()

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'read' })
    expect(result.documents[0]).toEqual(
      expect.objectContaining({ name: 'guide.markdown', virtualPath: 'docs/guide.markdown' }),
    )
    expect(result.assetPaths).toEqual(['images/cover.png'])
    expect(result.ignoredFiles).toEqual([
      { name: 'cover.png', virtualPath: 'images/cover.png' },
    ])
    await expect(registry.resolve('images/cover.png')).resolves.toBe('blob:asset')
  })

  it('detects external content conflicts even when the fingerprint is unchanged', async () => {
    const handle = new FakeFileHandle(
      'notes.md',
      new File(['original'], 'notes.md', { type: 'text/markdown', lastModified: 10 }),
    )
    const handles = new InMemoryFileHandleRegistry()
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      handleRegistry: handles,
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(async () => [handle] as unknown as FileSystemFileHandle[]),
        showDirectoryPicker: vi.fn(),
      },
      createId: () => 'notes-id',
      createHandleKey: () => 'notes-handle',
      now: () => 1,
    })
    const opened = await adapter.openFiles()
    const document = { ...opened.documents[0], text: 'my edit', dirty: true }
    handle.replaceExternally('changed!', 10)

    await expect(adapter.save(document)).resolves.toEqual({
      status: 'conflict',
      diskText: 'changed!',
      fingerprint: { lastModified: 10, size: 8 },
    })
    expect(handle.writes).toEqual([])
    expect(handle.requestPermissionCalls).toBe(0)

    const forced = await adapter.save(document, { force: true })

    expect(forced).toEqual({
      status: 'written',
      fingerprint: { lastModified: 11, size: 7 },
    })
    expect(handle.writes).toEqual(['my edit'])
    expect(handle.requestPermissionCalls).toBe(0)
  })

  it('treats a changed disk fingerprint as a conflict even when content matches', async () => {
    const handle = new FakeFileHandle(
      'notes.md',
      new File(['original'], 'notes.md', { type: 'text/markdown', lastModified: 10 }),
    )
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(async () => [handle] as unknown as FileSystemFileHandle[]),
        showDirectoryPicker: vi.fn(),
      },
      createId: () => 'notes-id',
      createHandleKey: () => 'notes-handle',
    })
    const opened = await adapter.openFiles()
    const document = { ...opened.documents[0], text: 'my edit', dirty: true }
    handle.replaceExternally('original', 20)

    await expect(adapter.save(document)).resolves.toEqual({
      status: 'conflict',
      diskText: 'original',
      fingerprint: { lastModified: 20, size: 8 },
    })
    expect(handle.writes).toEqual([])
  })

  it('requests write permission only through the explicit public method', async () => {
    const handle = new FakeFileHandle(
      'notes.md',
      new File(['original'], 'notes.md', { type: 'text/markdown', lastModified: 10 }),
    )
    handle.permission = 'prompt'
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(async () => [handle] as unknown as FileSystemFileHandle[]),
        showDirectoryPicker: vi.fn(),
      },
      createId: () => 'notes-id',
      createHandleKey: () => 'notes-handle',
    })
    const opened = await adapter.openFiles()
    const document = { ...opened.documents[0], text: 'edit', dirty: true }

    await expect(adapter.save(document)).resolves.toEqual({ status: 'permission-required' })
    expect(handle.requestPermissionCalls).toBe(0)

    await expect(adapter.requestWritePermission(document)).resolves.toBe('granted')
    expect(handle.requestPermissionCalls).toBe(1)
  })

  it('distinguishes denied write permission from prompt', async () => {
    const handle = new FakeFileHandle(
      'notes.md',
      new File(['original'], 'notes.md', { type: 'text/markdown', lastModified: 10 }),
    )
    handle.permission = 'denied'
    const adapter = adapterForHandle(handle)
    const opened = await adapter.openFiles()

    await expect(adapter.save({ ...opened.documents[0], text: 'edit', dirty: true })).resolves.toEqual({
      status: 'permission-denied',
    })
    expect(handle.requestPermissionCalls).toBe(0)
  })

  it('opens directories read-only and requests write access only after save needs it', async () => {
    const handle = new FakeFileHandle(
      'notes.md',
      new File(['original'], 'notes.md', { type: 'text/markdown', lastModified: 10 }),
    )
    handle.permission = 'prompt'
    const directory = fakeDirectory('project', [['notes.md', handle]])
    const showDirectoryPicker = vi.fn(
      async () => directory as unknown as FileSystemDirectoryHandle,
    )
    const adapter = new NativeFileAdapter({
      assetRegistry: createRegistry(),
      environment: {
        isSecureContext: true,
        showOpenFilePicker: vi.fn(),
        showDirectoryPicker,
      },
      createId: () => 'notes-id',
      createHandleKey: () => 'notes-handle',
    })

    const opened = await adapter.openDirectory()
    const document = { ...opened.documents[0], text: 'edit', dirty: true }

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'read' })
    expect(handle.requestPermissionCalls).toBe(0)
    await expect(adapter.save(document)).resolves.toEqual({ status: 'permission-required' })
    await expect(adapter.requestWritePermission(document)).resolves.toBe('granted')
    await expect(adapter.save(document)).resolves.toMatchObject({ status: 'written' })
    expect(handle.requestPermissionCalls).toBe(1)
  })

  it.each(['write', 'close'] as const)('aborts and rethrows when writable %s fails', async (stage) => {
    const handle = new FakeFileHandle(
      'notes.md',
      new File(['original'], 'notes.md', { type: 'text/markdown', lastModified: 10 }),
    )
    const failure = new Error(`${stage} failed`)
    if (stage === 'write') {
      handle.writeFailure = failure
      handle.abortFailure = new Error('abort failed')
    } else {
      handle.closeFailure = failure
    }
    const adapter = adapterForHandle(handle)
    const opened = await adapter.openFiles()

    await expect(
      adapter.save({ ...opened.documents[0], text: 'edit', dirty: true }),
    ).rejects.toBe(failure)
    expect(handle.abortCalls).toBe(1)
  })

  it('deletes only the requested in-memory handle', () => {
    const registry = new InMemoryFileHandleRegistry()
    const first = new FakeFileHandle('first.md', new File(['first'], 'first.md'))
    const second = new FakeFileHandle('second.md', new File(['second'], 'second.md'))
    registry.set('first', first as unknown as FileSystemFileHandle)
    registry.set('second', second as unknown as FileSystemFileHandle)

    registry.delete('first')

    expect(registry.get('first')).toBeUndefined()
    expect(registry.get('second')).toBe(second)
  })
})

function adapterForHandle(handle: FakeFileHandle) {
  return new NativeFileAdapter({
    assetRegistry: createRegistry(),
    environment: {
      isSecureContext: true,
      showOpenFilePicker: vi.fn(async () => [handle] as unknown as FileSystemFileHandle[]),
      showDirectoryPicker: vi.fn(),
    },
    createId: () => 'notes-id',
    createHandleKey: () => 'notes-handle',
  })
}
