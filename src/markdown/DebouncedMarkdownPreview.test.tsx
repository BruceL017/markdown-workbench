import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AssetRegistry } from '../files/assetRegistry'
import { DebouncedMarkdownPreview } from './DebouncedMarkdownPreview'

const registry = new AssetRegistry({
  createObjectURL: () => 'blob:test',
  revokeObjectURL: () => undefined,
})

function preview(markdown: string, documentKey = 'document-a') {
  return (
    <DebouncedMarkdownPreview
      markdown={markdown}
      documentKey={documentKey}
      currentDocumentPath={`${documentKey}.md`}
      assetRegistry={registry}
      ariaLabel="Debounced preview"
    />
  )
}

describe('DebouncedMarkdownPreview', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps the old content until 150ms and then commits the latest edit', () => {
    const { rerender } = render(preview('old content'))
    rerender(preview('new content'))

    act(() => vi.advanceTimersByTime(149))
    expect(screen.getByText('old content')).toBeInTheDocument()
    expect(screen.queryByText('new content')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('new content')).toBeInTheDocument()
    expect(screen.queryByText('old content')).not.toBeInTheDocument()
  })

  it('coalesces rapid edits and only renders the newest value', () => {
    const { rerender } = render(preview('zero'))
    rerender(preview('one'))
    act(() => vi.advanceTimersByTime(90))
    rerender(preview('two'))
    act(() => vi.advanceTimersByTime(149))

    expect(screen.getByText('zero')).toBeInTheDocument()
    expect(screen.queryByText('one')).not.toBeInTheDocument()
    expect(screen.queryByText('two')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('two')).toBeInTheDocument()
    expect(screen.queryByText('one')).not.toBeInTheDocument()
  })

  it('shows a newly selected document immediately without flashing the previous document', () => {
    const { rerender } = render(preview('document A draft', 'document-a'))
    rerender(preview('document B text', 'document-b'))

    expect(screen.getByText('document B text')).toBeInTheDocument()
    expect(screen.queryByText('document A draft')).not.toBeInTheDocument()
  })

  it('clears its pending timer when unmounted', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { rerender, unmount } = render(preview('before'))
    rerender(preview('after'))

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(150))
    clearTimeoutSpy.mockRestore()
  })
})
