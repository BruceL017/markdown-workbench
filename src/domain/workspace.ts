export type ViewMode = 'source' | 'preview'

export type ThemePreference = 'system' | 'light' | 'dark'

export type DocumentSourceKind = 'native' | 'fallback' | 'cache'

export interface DiskFingerprint {
  lastModified: number
  size: number
}

export interface WorkspaceDocument {
  id: string
  name: string
  virtualPath: string
  text: string
  savedText: string
  dirty: boolean
  sourceKind: DocumentSourceKind
  viewMode: ViewMode
  updatedAt: number
  diskFingerprint?: DiskFingerprint
  handleKey?: string
}

export interface WorkspaceSnapshot {
  schemaVersion: 1
  documents: WorkspaceDocument[]
  activeDocumentId: string | null
  layoutJson?: unknown
  theme?: ThemePreference
}
