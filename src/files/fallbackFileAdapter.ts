import type { WorkspaceDocument } from '../domain/workspace'
import type { AssetRegistry } from './assetRegistry'
import {
  createEmptyOpenResult,
  isMarkdownPath,
  type FileAdapter,
  type FileAdapterCapabilities,
  type OpenResult,
  type SaveResult,
} from './fileAdapter'
import { normalizeWorkspacePath } from './virtualPath'

export interface FilePickerRequest {
  directory: boolean
  multiple: boolean
}

export interface DomFilePicker {
  pickFiles(request: FilePickerRequest): Promise<File[]>
}

export interface DownloadEnvironment {
  document: Document
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export interface FallbackFileAdapterOptions {
  assetRegistry: Pick<AssetRegistry, 'register'>
  picker?: DomFilePicker
  downloadEnvironment?: DownloadEnvironment
  createId?: () => string
  now?: () => number
}

export class FallbackFileAdapter implements FileAdapter {
  readonly capabilities: FileAdapterCapabilities = {
    openFiles: true,
    openDirectory: true,
    writeBack: false,
    download: true,
  }

  private readonly assetRegistry: Pick<AssetRegistry, 'register'>
  private readonly picker: DomFilePicker
  private readonly downloadEnvironment?: DownloadEnvironment
  private readonly createId: () => string
  private readonly now: () => number

  constructor(options: FallbackFileAdapterOptions) {
    this.assetRegistry = options.assetRegistry
    this.picker = options.picker ?? createDomFilePicker(globalThis.document)
    this.downloadEnvironment = options.downloadEnvironment
    this.createId = options.createId ?? defaultId
    this.now = options.now ?? Date.now
  }

  async openFiles(): Promise<OpenResult> {
    const files = await this.picker.pickFiles({ directory: false, multiple: true })
    return this.openSelectedFiles(files, false)
  }

  async openDirectory(): Promise<OpenResult> {
    const files = await this.picker.pickFiles({ directory: true, multiple: true })
    return this.openSelectedFiles(files, true)
  }

  async save(document: WorkspaceDocument): Promise<SaveResult> {
    const environment = this.downloadEnvironment ?? defaultDownloadEnvironment()
    const blob = new Blob([document.text], { type: 'text/markdown;charset=utf-8' })
    const url = environment.createObjectURL(blob)
    const anchor = environment.document.createElement('a')
    anchor.href = url
    anchor.download = document.name
    anchor.hidden = true
    environment.document.body.append(anchor)

    try {
      anchor.click()
    } finally {
      anchor.remove()
      environment.revokeObjectURL(url)
    }

    return { status: 'downloaded', filename: document.name }
  }

  private async openSelectedFiles(files: File[], directory: boolean): Promise<OpenResult> {
    const result = createEmptyOpenResult()

    for (const file of files) {
      const virtualPath = virtualPathFor(file, directory)
      if (isMarkdownPath(virtualPath)) {
        const text = await file.text()
        result.documents.push({
          id: this.createId(),
          name: file.name,
          virtualPath,
          text,
          savedText: text,
          dirty: false,
          sourceKind: 'fallback',
          viewMode: 'preview',
          updatedAt: this.now(),
          diskFingerprint: { lastModified: file.lastModified, size: file.size },
        })
      } else {
        this.assetRegistry.register(virtualPath, file)
        result.assetPaths.push(virtualPath)
        result.ignoredFiles.push({ name: file.name, virtualPath })
      }
    }

    result.ignoredCount = result.ignoredFiles.length
    return result
  }
}

export function createDomFilePicker(document: Document): DomFilePicker {
  return {
    pickFiles(request) {
      return new Promise<File[]>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = request.multiple
        input.hidden = true

        if (request.directory) {
          input.setAttribute('webkitdirectory', '')
        } else {
          input.accept = '.md,.markdown'
        }

        let finished = false
        const finish = (files: File[]) => {
          if (finished) return
          finished = true
          input.remove()
          resolve(files)
        }

        input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
        input.addEventListener('cancel', () => finish([]))
        document.body.append(input)
        input.click()
      })
    },
  }
}

function virtualPathFor(file: File, directory: boolean): string {
  if (!directory || !file.webkitRelativePath) return normalizeWorkspacePath(file.name)

  const segments = file.webkitRelativePath.split('/')
  if (segments.length > 1) segments.shift()
  return normalizeWorkspacePath(segments.join('/'))
}

function defaultDownloadEnvironment(): DownloadEnvironment {
  return {
    document: globalThis.document,
    createObjectURL: URL.createObjectURL.bind(URL),
    revokeObjectURL: URL.revokeObjectURL.bind(URL),
  }
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}
