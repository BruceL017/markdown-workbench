import { EditorView } from '@codemirror/view'
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceLocaleProvider } from '../i18n/workspaceLocale'
import { MarkdownEditor } from './MarkdownEditor'

function editorView() {
  const view = EditorView.findFromDOM(
    screen.getByRole('textbox', { name: 'Markdown source' }),
  )
  if (!view) throw new Error('Expected a mounted CodeMirror EditorView')
  return view
}

describe('MarkdownEditor', () => {
  it('uses a real CodeMirror editor and reports document edits', () => {
    const onChange = vi.fn()
    render(
      <MarkdownEditor
        value="# Heading"
        onChange={onChange}
        ariaLabel="Markdown source"
      />,
    )

    const view = editorView()
    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n\nBody' },
    })

    expect(view.state.doc.toString()).toBe('# Heading\n\nBody')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('# Heading\n\nBody')
    expect(document.querySelector('.cm-lineNumbers')).toBeInTheDocument()
  })

  it('accepts keyboard input through the CodeMirror content DOM', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <MarkdownEditor value="" onChange={onChange} ariaLabel="Markdown source" />,
    )

    await user.click(screen.getByRole('textbox', { name: 'Markdown source' }))
    await user.keyboard('# Typed heading')

    await waitFor(() => expect(editorView().state.doc.toString()).toBe('# Typed heading'))
    expect(onChange).toHaveBeenLastCalledWith('# Typed heading')
  })

  it('synchronizes an external value without reporting it as a user edit', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MarkdownEditor value="first" onChange={onChange} ariaLabel="Markdown source" />,
    )

    rerender(
      <MarkdownEditor value="second" onChange={onChange} ariaLabel="Markdown source" />,
    )

    expect(editorView().state.doc.toString()).toBe('second')
    expect(onChange).not.toHaveBeenCalled()
    expect(undoDepth(editorView().state)).toBe(0)
    expect(undo(editorView())).toBe(false)
  })

  it('does not keep edits from the replaced value in the undo history', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MarkdownEditor value="first" onChange={onChange} ariaLabel="Markdown source" />,
    )
    const view = editorView()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' draft' } })
    expect(undoDepth(view.state)).toBe(1)
    onChange.mockClear()

    rerender(
      <MarkdownEditor value="second" onChange={onChange} ariaLabel="Markdown source" />,
    )

    expect(editorView().state.doc.toString()).toBe('second')
    expect(undoDepth(editorView().state)).toBe(0)
    expect(undo(editorView())).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears the redo branch when an external value replaces the document', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MarkdownEditor value="A" onChange={onChange} ariaLabel="Markdown source" />,
    )
    const view = editorView()
    view.dispatch({ changes: { from: 1, insert: ' edit' } })
    expect(undo(view)).toBe(true)
    expect(redoDepth(view.state)).toBe(1)
    onChange.mockClear()

    rerender(
      <MarkdownEditor value="NEW" onChange={onChange} ariaLabel="Markdown source" />,
    )

    expect(editorView().state.doc.toString()).toBe('NEW')
    expect(redoDepth(editorView().state)).toBe(0)
    expect(redo(editorView())).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not report transactions that only move the selection', () => {
    const onChange = vi.fn()
    render(
      <MarkdownEditor value="text" onChange={onChange} ariaLabel="Markdown source" />,
    )

    editorView().dispatch({ selection: { anchor: 2 } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('handles Mod-s through CodeMirror and prevents the browser default', () => {
    const onSave = vi.fn()
    render(
      <MarkdownEditor
        value="text"
        onChange={() => undefined}
        onSave={onSave}
        ariaLabel="Markdown source"
      />,
    )

    const eventAccepted = fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Markdown source' }),
      { key: 's', ctrlKey: true },
    )

    expect(eventAccepted).toBe(false)
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('reconfigures CodeMirror when the explicit color theme changes', async () => {
    document.documentElement.dataset.theme = 'dark'
    const { unmount } = render(
      <MarkdownEditor value="# Theme" onChange={() => undefined} ariaLabel="Markdown source" />,
    )

    expect(editorView().state.facet(EditorView.darkTheme)).toBe(true)

    document.documentElement.dataset.theme = 'light'
    await waitFor(() => expect(editorView().state.facet(EditorView.darkTheme)).toBe(false))

    unmount()
    delete document.documentElement.dataset.theme
  })

  it('reconfigures CodeMirror phrases without replacing the editor state', () => {
    const onChange = vi.fn()
    const localizedEditor = (locale: 'en' | 'zh-CN') => (
      <WorkspaceLocaleProvider locale={locale}>
        <MarkdownEditor
          value="draft"
          onChange={onChange}
          ariaLabel="Markdown source"
        />
      </WorkspaceLocaleProvider>
    )
    const { rerender } = render(localizedEditor('en'))
    const view = editorView()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' edit' } })
    view.focus()

    expect(undoDepth(view.state)).toBe(1)
    expect(view.hasFocus).toBe(true)

    rerender(localizedEditor('zh-CN'))

    expect(editorView()).toBe(view)
    expect(view.state.doc.toString()).toBe('draft edit')
    expect(view.hasFocus).toBe(true)
    expect(undoDepth(view.state)).toBe(1)

    fireEvent.keyDown(view.contentDOM, { key: 'f', ctrlKey: true })
    expect(screen.getByRole('textbox', { name: '查找' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '替换' })).toBeInTheDocument()

    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('draft')
  })

  it('destroys the EditorView when the component unmounts', () => {
    const destroy = vi.spyOn(EditorView.prototype, 'destroy')
    const { unmount } = render(
      <MarkdownEditor value="text" onChange={() => undefined} ariaLabel="Markdown source" />,
    )

    unmount()

    expect(destroy).toHaveBeenCalledOnce()
    destroy.mockRestore()
  })
})
