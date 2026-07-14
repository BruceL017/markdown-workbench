import type { DiskFingerprint, WorkspaceDocument } from '../domain/workspace'

export interface FileAdapterCapabilities {
  openFiles: boolean
  openDirectory: boolean
  writeBack: boolean
  download: boolean
}

export interface IgnoredFile {
  name: string
  virtualPath: string
}

export interface OpenResult {
  documents: WorkspaceDocument[]
  assetPaths: string[]
  ignoredFiles: IgnoredFile[]
  ignoredCount: number
}

export interface SaveOptions {
  force?: boolean
}

export type SaveResult =
  | { status: 'written'; fingerprint: DiskFingerprint }
  | { status: 'downloaded'; filename: string }
  | { status: 'conflict'; fingerprint: DiskFingerprint; diskText: string }
  | { status: 'permission-required' }
  | { status: 'permission-denied' }
  | { status: 'unavailable' }

export interface FileAdapter {
  readonly capabilities: FileAdapterCapabilities
  openFiles(): Promise<OpenResult>
  openDirectory(): Promise<OpenResult>
  save(document: WorkspaceDocument, options?: SaveOptions): Promise<SaveResult>
  requestWritePermission(document: WorkspaceDocument): Promise<PermissionState>
}

export function createEmptyOpenResult(): OpenResult {
  return {
    documents: [],
    assetPaths: [],
    ignoredFiles: [],
    ignoredCount: 0,
  }
}

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path)
}
