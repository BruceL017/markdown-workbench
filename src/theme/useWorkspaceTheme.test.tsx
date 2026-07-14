import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ThemePreference } from '../domain/workspace'
import { useWorkspaceTheme } from './useWorkspaceTheme'

afterEach(() => {
  delete document.documentElement.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.remove()
})

describe('useWorkspaceTheme', () => {
  it('tracks system color changes only in System mode and removes listeners', () => {
    const themeColor = document.createElement('meta')
    themeColor.name = 'theme-color'
    document.head.append(themeColor)
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
    expect(themeColor).toHaveAttribute('content', '#f8f9fb')
    dark = true
    act(() => listener?.())
    expect(result.current).toBe('dark')
    expect(themeColor).toHaveAttribute('content', '#1b1d20')

    rerender({ preference: 'light' })
    expect(result.current).toBe('light')
    expect(themeColor).toHaveAttribute('content', '#f8f9fb')
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
