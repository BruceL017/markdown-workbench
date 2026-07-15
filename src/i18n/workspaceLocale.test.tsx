import { renderHook } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import type { Locale } from '../domain/workspace'
import {
  WorkspaceLocaleProvider,
  codeMirrorPhrases,
  resolveLocale,
  translate,
  useWorkspaceLocale,
} from './workspaceLocale'

describe('workspace locale', () => {
  it('uses an explicit preference before browser languages', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN')
  })

  it('uses Simplified Chinese for any Chinese browser locale and English otherwise', () => {
    expect(resolveLocale(null, ['fr-FR', 'zh-Hant'])).toBe('zh-CN')
    expect(resolveLocale(null, ['en-US'])).toBe('en')
    expect(resolveLocale(null, [])).toBe('en')
  })

  it('interpolates localized workspace messages', () => {
    expect(translate('en', 'status.openedOne', { name: 'notes.md' }))
      .toBe('Opened notes.md.')
    expect(translate('zh-CN', 'status.openedMany', { count: 3 }))
      .toBe('已打开 3 个 Markdown 文件。')
  })

  it('provides the selected locale and translator through context', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceLocaleProvider locale={'zh-CN' satisfies Locale}>
        {children}
      </WorkspaceLocaleProvider>
    )
    const { result } = renderHook(() => useWorkspaceLocale(), { wrapper })

    expect(result.current.locale).toBe('zh-CN')
    expect(result.current.t('app.title')).toBe('Markdown 工作台')
  })

  it('provides Chinese CodeMirror phrases without overriding English defaults', () => {
    expect(codeMirrorPhrases('en')).toEqual({})
    expect(codeMirrorPhrases('zh-CN')).toMatchObject({
      Find: '查找',
      Replace: '替换',
      'replace all': '全部替换',
      close: '关闭',
    })
  })
})
