import { useEffect, useState } from 'react'

import type { ThemePreference } from '../domain/workspace'

export type ResolvedTheme = 'light' | 'dark'

export function useWorkspaceTheme(
  preference: ThemePreference,
  suppliedMedia?: MediaQueryList,
): ResolvedTheme {
  const [media] = useState(() => suppliedMedia ?? (
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : undefined
  ))
  const resolve = (): ResolvedTheme =>
    preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference
  const [resolved, setResolved] = useState<ResolvedTheme>(resolve)

  useEffect(() => {
    const apply = () => {
      const next = resolve()
      setResolved(next)
      document.documentElement.dataset.theme = next
    }
    apply()
    if (preference === 'system') media?.addEventListener('change', apply)

    return () => {
      if (preference === 'system') media?.removeEventListener('change', apply)
      delete document.documentElement.dataset.theme
    }
  }, [media, preference])

  return resolved
}
