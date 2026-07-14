interface PersistentStorageManager {
  persist?: () => Promise<boolean>
}

export async function requestPersistentStorage(
  storageManager: PersistentStorageManager | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.storage,
): Promise<boolean> {
  try {
    if (!storageManager?.persist) {
      return false
    }
    return await storageManager.persist()
  } catch {
    return false
  }
}
