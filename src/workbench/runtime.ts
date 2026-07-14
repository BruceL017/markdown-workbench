import { AssetRegistry } from '../files/assetRegistry'
import type { FileAdapter } from '../files/fileAdapter'
import {
  InMemoryFileHandleRegistry,
  NativeFileAdapter,
} from '../files/nativeFileAdapter'
import { FallbackFileAdapter } from '../files/fallbackFileAdapter'
import { createWorkspaceStore } from '../state/workspaceStore'

export interface WorkbenchRuntime {
  store: ReturnType<typeof createWorkspaceStore>
  assetRegistry: AssetRegistry
  nativeAdapter: FileAdapter
  fallbackAdapter: FileAdapter
}

export function createWorkbenchRuntime(): WorkbenchRuntime {
  const assetRegistry = new AssetRegistry()
  const handleRegistry = new InMemoryFileHandleRegistry()

  return {
    store: createWorkspaceStore(),
    assetRegistry,
    nativeAdapter: new NativeFileAdapter({ assetRegistry, handleRegistry }),
    fallbackAdapter: new FallbackFileAdapter({ assetRegistry }),
  }
}
