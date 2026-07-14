import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ThemePreference } from '../domain/workspace'
import { useWorkspaceTheme } from './useWorkspaceTheme'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('useWorkspaceTheme', () => {
  it('tracks system color changes only in System mode and removes listeners', () => {
    let dark = false
    let listener: (() => void) | undefined
    const media = {
      get matches() {
        return dark
      },
      addEventListener: vi.fn((_event: string, next: () => void) => {
        listener = next
      }),
      removeEventListener: vi.fn((_event: string, removed: () => void) => {
        if (listener === removed) listener = undefined
      }),
    } as unknown as MediaQueryList

    const { result, rerender, unmount } = renderHook(
      ({ preference }: { preference: ThemePreference }) =>
        useWorkspaceTheme(preference, media),
      { initialProps: { preference: 'system' as ThemePreference } },
    )

    expect(result.current).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    dark = true
    act(() => listener?.())
    expect(result.current).toBe('dark')

    rerender({ preference: 'light' })
    expect(result.current).toBe('light')
    expect(media.removeEventListener).toHaveBeenCalled()
    const removals = vi.mocked(media.removeEventListener).mock.calls.length
    act(() => listener?.())
    expect(result.current).toBe('light')
    expect(media.addEventListener).toHaveBeenCalledTimes(1)

    unmount()
    expect(media.removeEventListener).toHaveBeenCalledTimes(removals)
    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })
})
