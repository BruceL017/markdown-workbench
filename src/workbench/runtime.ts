import { AssetRegistry } from '../files/assetRegistry'
import type { FileAdapter } from '../files/fileAdapter'
import {
  InMemoryFileHandleRegistry,
  NativeFileAdapter,
  type FileHandleRegistry,
} from '../files/nativeFileAdapter'
import { FallbackFileAdapter } from '../files/fallbackFileAdapter'
import { createWorkspaceStore } from '../state/workspaceStore'
import {
  createWorkspacePersistence,
  type WorkspacePersistence,
} from '../persistence/indexedDbWorkspace'

export interface WorkbenchRuntime {
  store: ReturnType<typeof createWorkspaceStore>
  assetRegistry: AssetRegistry
  nativeHandleRegistry: FileHandleRegistry
  nativeAdapter: FileAdapter
  fallbackAdapter: FileAdapter
  persistence?: WorkspacePersistence
}

interface WorkbenchRuntimeOptions {
  assetRegistry?: AssetRegistry
  handleRegistry?: FileHandleRegistry
  persistence?: WorkspacePersistence
}

export function createWorkbenchRuntime(
  options: WorkbenchRuntimeOptions = {},
): WorkbenchRuntime {
  const assetRegistry = options.assetRegistry ?? new AssetRegistry()
  const handleRegistry = options.handleRegistry ?? new InMemoryFileHandleRegistry()

  return {
    store: createWorkspaceStore(),
    assetRegistry,
    nativeHandleRegistry: handleRegistry,
    nativeAdapter: new NativeFileAdapter({ assetRegistry, handleRegistry }),
    fallbackAdapter: new FallbackFileAdapter({ assetRegistry }),
    persistence: options.persistence ?? createWorkspacePersistence(),
  }
}
