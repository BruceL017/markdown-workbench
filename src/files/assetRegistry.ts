import { normalizeWorkspacePath } from './virtualPath'

export type AssetSource = File | (() => Promise<File>)

export interface ObjectUrlApi {
  createObjectURL: (file: Blob) => string
  revokeObjectURL: (url: string) => void
}

interface AssetEntry {
  source: AssetSource
  objectUrl?: string
  pending?: Promise<string | undefined>
}

export class AssetRegistry {
  private readonly entries = new Map<string, AssetEntry>()

  constructor(private readonly urlApi: ObjectUrlApi = URL) {}

  register(path: string, source: AssetSource) {
    const normalizedPath = normalizeWorkspacePath(path)
    const existing = this.entries.get(normalizedPath)
    if (existing?.objectUrl) this.urlApi.revokeObjectURL(existing.objectUrl)
    this.entries.set(normalizedPath, { source })
  }

  async resolve(path: string): Promise<string | undefined> {
    const normalizedPath = normalizeWorkspacePath(path)
    const entry = this.entries.get(normalizedPath)
    if (!entry) return undefined
    if (entry.objectUrl) return entry.objectUrl
    if (entry.pending) return entry.pending

    entry.pending = this.materialize(normalizedPath, entry)
    return entry.pending
  }

  replace(entries: Iterable<readonly [string, AssetSource]>) {
    this.clear()
    for (const [path, source] of entries) this.register(path, source)
  }

  clear() {
    for (const entry of this.entries.values()) {
      if (entry.objectUrl) this.urlApi.revokeObjectURL(entry.objectUrl)
    }
    this.entries.clear()
  }

  private async materialize(path: string, entry: AssetEntry): Promise<string | undefined> {
    try {
      const file = typeof entry.source === 'function' ? await entry.source() : entry.source
      const objectUrl = this.urlApi.createObjectURL(file)

      if (this.entries.get(path) !== entry) {
        this.urlApi.revokeObjectURL(objectUrl)
        return undefined
      }

      entry.objectUrl = objectUrl
      return objectUrl
    } finally {
      entry.pending = undefined
    }
  }
}
