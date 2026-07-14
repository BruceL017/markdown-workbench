import type { WorkspaceDocument } from '../domain/workspace'
import type { AssetRegistry } from './assetRegistry'
import {
  createEmptyOpenResult,
  isMarkdownPath,
  type FileAdapter,
  type FileAdapterCapabilities,
  type OpenResult,
  type SaveOptions,
  type SaveResult,
} from './fileAdapter'
import { normalizeWorkspacePath } from './virtualPath'

type OpenFilePicker = (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
type DirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>

export interface NativeFileSystemEnvironment {
  isSecureContext: boolean
  showOpenFilePicker?: OpenFilePicker
  showDirectoryPicker?: DirectoryPicker
}

export interface FileHandleRegistry {
  get(key: string): FileSystemFileHandle | undefined
  set(key: string, handle: FileSystemFileHandle): void
  entries(): IterableIterator<[string, FileSystemFileHandle]>
  clear(): void
}

export class InMemoryFileHandleRegistry implements FileHandleRegistry {
  private readonly handles = new Map<string, FileSystemFileHandle>()

  get(key: string) {
    return this.handles.get(key)
  }

  set(key: string, handle: FileSystemFileHandle) {
    this.handles.set(key, handle)
  }

  entries() {
    return this.handles.entries()
  }

  clear() {
    this.handles.clear()
  }
}

export interface NativeFileAdapterOptions {
  assetRegistry: Pick<AssetRegistry, 'register'>
  environment?: NativeFileSystemEnvironment
  handleRegistry?: FileHandleRegistry
  createId?: () => string
  createHandleKey?: (handle: FileSystemFileHandle, documentId: string) => string
  now?: () => number
}

const markdownPickerOptions: OpenFilePickerOptions = {
  multiple: true,
  excludeAcceptAllOption: true,
  types: [
    {
      description: 'Markdown',
      accept: { 'text/markdown': ['.md', '.markdown'] },
    },
  ],
}

export function getNativeFileAdapterCapabilities(
  environment: NativeFileSystemEnvironment,
): FileAdapterCapabilities {
  const secure = environment.isSecureContext === true
  const openFiles = secure && typeof environment.showOpenFilePicker === 'function'
  const openDirectory = secure && typeof environment.showDirectoryPicker === 'function'

  return {
    openFiles,
    openDirectory,
    writeBack: openFiles || openDirectory,
    download: false,
  }
}

export class NativeFileAdapter implements FileAdapter {
  readonly capabilities: FileAdapterCapabilities
  private readonly assetRegistry: Pick<AssetRegistry, 'register'>
  private readonly environment: NativeFileSystemEnvironment
  private readonly handleRegistry: FileHandleRegistry
  private readonly createId: () => string
  private readonly createHandleKey: (handle: FileSystemFileHandle, documentId: string) => string
  private readonly now: () => number

  constructor(options: NativeFileAdapterOptions) {
    this.assetRegistry = options.assetRegistry
    this.environment = options.environment ?? defaultNativeEnvironment()
    this.handleRegistry = options.handleRegistry ?? new InMemoryFileHandleRegistry()
    this.createId = options.createId ?? defaultId
    this.createHandleKey = options.createHandleKey ?? ((_handle, id) => `native:${id}`)
    this.now = options.now ?? Date.now
    this.capabilities = getNativeFileAdapterCapabilities(this.environment)
  }

  async openFiles(): Promise<OpenResult> {
    const picker = this.environment.showOpenFilePicker
    if (!this.capabilities.openFiles || !picker) throw new Error('Native file picker is unavailable')

    try {
      const handles = await picker(markdownPickerOptions)
      return this.openFileHandles(handles)
    } catch (error) {
      if (isAbortError(error)) return createEmptyOpenResult()
      throw error
    }
  }

  async openDirectory(): Promise<OpenResult> {
    const picker = this.environment.showDirectoryPicker
    if (!this.capabilities.openDirectory || !picker) {
      throw new Error('Native directory picker is unavailable')
    }

    try {
      const directory = await picker({ mode: 'readwrite' })
      const result = createEmptyOpenResult()
      await this.walkDirectory(directory, '', result)
      result.ignoredCount = result.ignoredFiles.length
      return result
    } catch (error) {
      if (isAbortError(error)) return createEmptyOpenResult()
      throw error
    }
  }

  async save(document: WorkspaceDocument, options: SaveOptions = {}): Promise<SaveResult> {
    const handle = document.handleKey ? this.handleRegistry.get(document.handleKey) : undefined
    if (!handle) return { status: 'unavailable' }

    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') return { status: 'permission-denied' }

    const diskFile = await handle.getFile()
    const fingerprint = fingerprintFor(diskFile)
    const diskText = await diskFile.text()
    const fingerprintChanged =
      document.diskFingerprint !== undefined &&
      (fingerprint.lastModified !== document.diskFingerprint.lastModified ||
        fingerprint.size !== document.diskFingerprint.size)
    if (!options.force && (fingerprintChanged || diskText !== document.savedText)) {
      return { status: 'conflict', fingerprint, diskText }
    }

    const writable = await handle.createWritable()
    await writable.write(document.text)
    await writable.close()
    const writtenFile = await handle.getFile()

    return { status: 'written', fingerprint: fingerprintFor(writtenFile) }
  }

  async requestWritePermission(document: WorkspaceDocument): Promise<PermissionState> {
    const handle = document.handleKey ? this.handleRegistry.get(document.handleKey) : undefined
    if (!handle) return 'denied'

    const current = await handle.queryPermission({ mode: 'readwrite' })
    if (current === 'granted') return current
    return handle.requestPermission({ mode: 'readwrite' })
  }

  private async openFileHandles(handles: FileSystemFileHandle[]): Promise<OpenResult> {
    const result = createEmptyOpenResult()

    for (const handle of handles) {
      const virtualPath = normalizeWorkspacePath(handle.name)
      if (isMarkdownPath(virtualPath)) {
        result.documents.push(await this.openDocument(handle, virtualPath))
      } else {
        this.registerAsset(handle, virtualPath, result)
      }
    }

    result.ignoredCount = result.ignoredFiles.length
    return result
  }

  private async walkDirectory(
    directory: FileSystemDirectoryHandle,
    parentPath: string,
    result: OpenResult,
  ): Promise<void> {
    for await (const [name, entry] of directory.entries()) {
      const virtualPath = normalizeWorkspacePath(parentPath ? `${parentPath}/${name}` : name)

      if (entry.kind === 'directory') {
        await this.walkDirectory(entry, virtualPath, result)
      } else if (isMarkdownPath(virtualPath)) {
        result.documents.push(await this.openDocument(entry, virtualPath))
      } else {
        this.registerAsset(entry, virtualPath, result)
      }
    }
  }

  private async openDocument(
    handle: FileSystemFileHandle,
    virtualPath: string,
  ): Promise<WorkspaceDocument> {
    const file = await handle.getFile()
    const text = await file.text()
    const id = this.createId()
    const handleKey = this.createHandleKey(handle, id)
    this.handleRegistry.set(handleKey, handle)

    return {
      id,
      name: file.name,
      virtualPath,
      text,
      savedText: text,
      dirty: false,
      sourceKind: 'native',
      viewMode: 'preview',
      updatedAt: this.now(),
      diskFingerprint: fingerprintFor(file),
      handleKey,
    }
  }

  private registerAsset(handle: FileSystemFileHandle, virtualPath: string, result: OpenResult) {
    this.assetRegistry.register(virtualPath, () => handle.getFile())
    result.assetPaths.push(virtualPath)
    result.ignoredFiles.push({ name: handle.name, virtualPath })
  }
}

function fingerprintFor(file: File) {
  return { lastModified: file.lastModified, size: file.size }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function defaultNativeEnvironment(): NativeFileSystemEnvironment {
  const browser = globalThis as typeof globalThis & {
    isSecureContext?: boolean
    showOpenFilePicker?: OpenFilePicker
    showDirectoryPicker?: DirectoryPicker
  }

  return {
    isSecureContext: browser.isSecureContext === true,
    showOpenFilePicker: browser.showOpenFilePicker?.bind(browser),
    showDirectoryPicker: browser.showDirectoryPicker?.bind(browser),
  }
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}
