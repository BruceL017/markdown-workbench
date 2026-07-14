import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceDocument } from '../domain/workspace'
import { AssetRegistry } from './assetRegistry'
import type { FileAdapter } from './fileAdapter'
import {
  FallbackFileAdapter,
  createDomFilePicker,
  type FilePickerRequest,
} from './fallbackFileAdapter'

function directoryFile(path: string, text: string, type: string) {
  const name = path.split('/').at(-1) ?? path
  const file = new File([text], name, { type, lastModified: 50 })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

function createRegistry() {
  return new AssetRegistry({
    createObjectURL: vi.fn(() => 'blob:asset'),
    revokeObjectURL: vi.fn(),
  })
}

function createDocument(): WorkspaceDocument {
  return {
    id: 'document-1',
    name: 'notes.md',
    virtualPath: 'notes.md',
    text: '# edited',
    savedText: '# old',
    dirty: true,
    sourceKind: 'fallback',
    viewMode: 'preview',
    updatedAt: 10,
  }
}

describe('fallback file adapter', () => {
  it('builds a workspace-root-relative directory tree and separates assets', async () => {
    const markdown = directoryFile(
      'project/docs/read me.md',
      '# Guide',
      'text/markdown',
    )
    const asset = directoryFile('project/images/cover.png', 'image', 'image/png')
    const picker = {
      pickFiles: vi.fn(async (_request: FilePickerRequest) => [markdown, asset]),
    }
    const registry = createRegistry()
    const adapter = new FallbackFileAdapter({
      assetRegistry: registry,
      picker,
      createId: () => 'guide-id',
      now: () => 100,
    })

    const result = await adapter.openDirectory()

    expect(picker.pickFiles).toHaveBeenCalledWith({ directory: true, multiple: true })
    expect(result.documents).toEqual([
      expect.objectContaining({
        id: 'guide-id',
        name: 'read me.md',
        virtualPath: 'docs/read me.md',
        text: '# Guide',
        savedText: '# Guide',
        dirty: false,
        sourceKind: 'fallback',
        viewMode: 'preview',
        updatedAt: 100,
      }),
    ])
    expect(result.assetPaths).toEqual(['images/cover.png'])
    expect(result.ignoredFiles).toEqual([
      { name: 'cover.png', virtualPath: 'images/cover.png' },
    ])
    expect(result.ignoredCount).toBe(1)
    await expect(registry.resolve('images/cover.png')).resolves.toBe('blob:asset')
  })

  it('returns an empty result for a cancelled input selection', async () => {
    const adapter = new FallbackFileAdapter({
      assetRegistry: createRegistry(),
      picker: { pickFiles: vi.fn(async () => []) },
    })

    await expect(adapter.openFiles()).resolves.toEqual({
      documents: [],
      assetPaths: [],
      ignoredFiles: [],
      ignoredCount: 0,
    })
  })

  it('creates an injectable DOM picker with directory and cancellation behavior', async () => {
    const clickedInputs: HTMLInputElement[] = []
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(function (this: HTMLInputElement) {
        clickedInputs.push(this)
        this.dispatchEvent(new Event('cancel'))
      })
    const picker = createDomFilePicker(document)

    await expect(picker.pickFiles({ directory: true, multiple: true })).resolves.toEqual([])

    expect(clickedInputs).toHaveLength(1)
    expect(clickedInputs[0].type).toBe('file')
    expect(clickedInputs[0].multiple).toBe(true)
    expect(clickedInputs[0].accept).toBe('')
    expect(clickedInputs[0].hasAttribute('webkitdirectory')).toBe(true)
    expect(document.body.contains(clickedInputs[0])).toBe(false)
    click.mockRestore()
  })

  it('downloads a Blob copy and reports downloaded instead of written', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:download')
    const revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const adapter = new FallbackFileAdapter({
      assetRegistry: createRegistry(),
      picker: { pickFiles: vi.fn(async () => []) },
      downloadEnvironment: {
        document,
        createObjectURL,
        revokeObjectURL,
      },
    })

    await expect(adapter.save(createDocument())).resolves.toEqual({
      status: 'downloaded',
      filename: 'notes.md',
    })

    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    await expect(readBlob(blob)).resolves.toBe('# edited')
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('notes.md')
    expect(anchor.href).toBe('blob:download')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
    click.mockRestore()
  })

  it('implements the shared permission request contract without write-back support', async () => {
    const adapter: FileAdapter = new FallbackFileAdapter({
      assetRegistry: createRegistry(),
      picker: { pickFiles: vi.fn(async () => []) },
    })

    await expect(adapter.requestWritePermission(createDocument())).resolves.toBe('denied')
  })
})

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsText(blob)
  })
}
