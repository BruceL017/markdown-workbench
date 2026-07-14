import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AssetRegistry } from '../files/assetRegistry'
import { MarkdownPreview } from './MarkdownPreview'

function createRegistry() {
  let nextId = 0
  const urlApi = {
    createObjectURL: vi.fn(() => `blob:asset-${++nextId}`),
    revokeObjectURL: vi.fn(),
  }

  return { registry: new AssetRegistry(urlApi), urlApi }
}

function renderPreview(
  markdown: string,
  options: {
    registry?: AssetRegistry
    currentDocumentPath?: string
    onOpenDocument?: (path: string, hash?: string) => void
  } = {},
) {
  const registry = options.registry ?? createRegistry().registry

  return render(
    <MarkdownPreview
      markdown={markdown}
      currentDocumentPath={options.currentDocumentPath ?? 'docs/readme.md'}
      assetRegistry={registry}
      onOpenDocument={options.onOpenDocument}
      ariaLabel="Rendered document"
    />,
  )
}

describe('MarkdownPreview', () => {
  it('renders GFM tables, task lists, strikethrough, and automatic links', () => {
    const markdown = [
      '| Name | Value |',
      '| --- | --- |',
      '| One | 1 |',
      '',
      '- [x] shipped',
      '- [ ] queued',
      '',
      '~~removed~~',
      '',
      'https://example.com/docs',
    ].join('\n')

    const { container } = renderPreview(markdown)

    expect(screen.getByRole('table')).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[0]).toBeDisabled()
    expect(container.querySelector('del')).toHaveTextContent('removed')
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    )
  })

  it('keeps safe raw HTML while removing active content, handlers, and styles', () => {
    const markdown = [
      '<details open><summary>More</summary><kbd>Ctrl</kbd> <mark>safe</mark></details>',
      '<script>script-marker</script>',
      '<style>.style-marker { color: red }</style>',
      '<iframe src="https://example.com">iframe-marker</iframe>',
      '<object data="https://example.com">object-marker</object>',
      '<embed src="https://example.com">',
      '<form action="https://example.com">form-marker</form>',
      '<p id="unsafe-id" onclick="alert(1)" style="color:red">Paragraph</p>',
      '<a href="javascript:alert(1)">Danger</a>',
      '<img src="https://example.com/image.png" alt="Remote" onerror="alert(1)" style="display:none">',
    ].join('\n\n')

    const { container } = renderPreview(markdown)

    expect(container.querySelector('details[open]')).toBeInTheDocument()
    expect(container.querySelector('summary')).toHaveTextContent('More')
    expect(container.querySelector('kbd')).toHaveTextContent('Ctrl')
    expect(container.querySelector('mark')).toHaveTextContent('safe')
    expect(container.querySelector('script, style, iframe, object, embed, form')).toBeNull()
    // GFM tagfilter renders these blocked raw tags as inert text before sanitize runs.
    expect(container).toHaveTextContent('<script>script-marker</script>')
    expect(container).toHaveTextContent('<style>.style-marker { color: red }</style>')
    expect(container).toHaveTextContent(
      '<iframe src="https://example.com">iframe-marker</iframe>',
    )
    expect(container).not.toHaveTextContent('object-marker')
    expect(container).not.toHaveTextContent('form-marker')

    const paragraph = screen.getByText('Paragraph')
    expect(paragraph).not.toHaveAttribute('onclick')
    expect(paragraph).not.toHaveAttribute('style')
    expect(paragraph.id).toBe('user-content-unsafe-id')
    expect(screen.getByText('Danger')).not.toHaveAttribute('href')

    const image = screen.getByRole('img', { name: 'Remote' })
    expect(image).not.toHaveAttribute('onerror')
    expect(image).not.toHaveAttribute('style')
  })

  it('highlights known fenced languages after sanitization and leaves other code as text', () => {
    const markdown = [
      '```js',
      'const answer = 42',
      '```',
      '',
      '```unknown-language',
      '<tag>plain</tag>',
      '```',
      '',
      '```',
      'const notDetected = true',
      '```',
    ].join('\n')

    const { container } = renderPreview(markdown)
    const blocks = container.querySelectorAll('pre code')

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toHaveClass('hljs', 'language-js')
    expect(blocks[0].querySelector('.hljs-keyword')).toHaveTextContent('const')
    expect(blocks[1]).toHaveTextContent('<tag>plain</tag>')
    expect(blocks[1].querySelector('span')).toBeNull()
    expect(blocks[2]).toHaveTextContent('const notDetected = true')
    expect(blocks[2]).not.toHaveClass('hljs')
    expect(blocks[2].querySelector('span')).toBeNull()
  })

  it('adds privacy and loading attributes to remote HTTP images', () => {
    renderPreview(
      [
        '![Diagram](https://images.example.com/diagram.png "Title")',
        '![Uppercase](HTTPS://images.example.com/uppercase.png)',
      ].join('\n\n'),
    )

    const image = screen.getByRole('img', { name: 'Diagram' })
    expect(image).toHaveAttribute('src', 'https://images.example.com/diagram.png')
    expect(image).toHaveAttribute('title', 'Title')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByRole('img', { name: 'Uppercase' })).toHaveAttribute(
      'src',
      'HTTPS://images.example.com/uppercase.png',
    )
  })

  it('allows only approved base64 raster data images', () => {
    const png = 'DATA:image/png;base64,aGVsbG8='
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    const text = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
    renderPreview(
      [
        `<img src="${png}" alt="Raster">`,
        `<img src="${svg}" alt="Vector">`,
        `<img src="${text}" alt="Document">`,
      ].join('\n\n'),
    )

    expect(screen.getByRole('img', { name: 'Raster' })).toHaveAttribute('src', png)
    expect(screen.getByRole('img', { name: 'Vector image unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Document image unavailable' })).toBeInTheDocument()
    expect(screen.queryByAltText('Vector')).not.toBeInTheDocument()
    expect(screen.queryByAltText('Document')).not.toBeInTheDocument()
  })

  it('resolves Markdown and raw HTML local images through the workspace registry', async () => {
    const { registry, urlApi } = createRegistry()
    registry.register('docs/assets/diagram.png', new File(['diagram'], 'diagram.png'))
    registry.register('docs/assets/photo.webp', new File(['photo'], 'photo.webp'))

    renderPreview(
      [
        '![Diagram](./assets/diagram.png)',
        '<img src="assets/photo.webp" alt="Photo">',
      ].join('\n\n'),
      { registry },
    )

    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(await screen.findByRole('img', { name: 'Diagram' })).toHaveAttribute(
      'src',
      'blob:asset-1',
    )
    expect(await screen.findByRole('img', { name: 'Photo' })).toHaveAttribute(
      'src',
      'blob:asset-2',
    )
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(2)
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('shows accessible placeholders for missing, rejected, and resolving local images', async () => {
    const { registry } = createRegistry()
    let finishLoading!: (file: File) => void
    registry.register(
      'docs/assets/slow.png',
      () =>
        new Promise<File>((resolve) => {
          finishLoading = resolve
        }),
    )

    renderPreview(
      [
        '![Slow](assets/slow.png)',
        '![Missing](assets/missing.png)',
        '![Escaped](../../outside.png)',
      ].join('\n\n'),
      { registry },
    )

    expect(screen.getByRole('status', { name: 'Loading Slow image' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Missing image unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Escaped image unavailable' })).toBeInTheDocument()

    finishLoading(new File(['slow'], 'slow.png'))
    expect(await screen.findByRole('img', { name: 'Slow' })).toHaveAttribute(
      'src',
      'blob:asset-1',
    )
  })

  it('keeps anchors local, opens web links safely, and routes workspace Markdown links', () => {
    const onOpenDocument = vi.fn()
    renderPreview(
      [
        '[Section](#part)',
        '[Web](https://example.com/page)',
        '[Upper web](HtTpS://example.com/upper)',
        '[Sibling](guide.md#install)',
        '[Root](/reference/api.markdown#auth)',
        '[Mail](MAILTO:writer@example.com)',
      ].join(' '),
      { onOpenDocument },
    )

    const anchor = screen.getByRole('link', { name: 'Section' })
    expect(anchor).toHaveAttribute('href', '#user-content-part')
    expect(anchor).not.toHaveAttribute('target')

    const web = screen.getByRole('link', { name: 'Web' })
    expect(web).toHaveAttribute('target', '_blank')
    expect(web).toHaveAttribute('rel', 'noopener noreferrer')

    const upperWeb = screen.getByRole('link', { name: 'Upper web' })
    expect(upperWeb).toHaveAttribute('href', 'HtTpS://example.com/upper')
    expect(upperWeb).toHaveAttribute('target', '_blank')

    fireEvent.click(screen.getByRole('link', { name: 'Sibling' }))
    expect(onOpenDocument).toHaveBeenCalledWith(
      'docs/guide.md',
      '#user-content-install',
    )

    fireEvent.click(screen.getByRole('link', { name: 'Root' }))
    expect(onOpenDocument).toHaveBeenCalledWith(
      'reference/api.markdown',
      '#user-content-auth',
    )

    expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute(
      'href',
      'MAILTO:writer@example.com',
    )
  })

  it('maps a local fragment to the sanitized raw element id', () => {
    const { container } = renderPreview(
      ['<h2 id="part">Part</h2>', '[Jump](#part)'].join('\n\n'),
    )

    const target = screen.getByRole('heading', { name: 'Part' })
    const jump = screen.getByRole('link', { name: 'Jump' })
    expect(target).toHaveAttribute('id', 'user-content-part')
    expect(jump).toHaveAttribute('href', '#user-content-part')
    expect(container.querySelector(jump.getAttribute('href')!)).toBe(target)
  })

  it('passes a cross-document hash that selects the sanitized target', () => {
    const onOpenDocument = vi.fn()
    const source = renderPreview('[Install](guide.md#install)', { onOpenDocument })

    fireEvent.click(screen.getByRole('link', { name: 'Install' }))

    expect(onOpenDocument).toHaveBeenCalledWith(
      'docs/guide.md',
      '#user-content-install',
    )
    const callbackHash = onOpenDocument.mock.calls[0]?.[1]
    if (!callbackHash) throw new Error('Expected a callback hash')

    source.unmount()
    const target = renderPreview('<h2 id="install">Install target</h2>', {
      currentDocumentPath: 'docs/guide.md',
    })
    expect(target.container.querySelector(callbackHash)).toBe(
      screen.getByRole('heading', { name: 'Install target' }),
    )
  })

  it('preserves sanitized titles, identifiers, and accessible names on links', () => {
    const { container } = renderPreview(
      [
        '[Titled](notes.txt "Local title")',
        '<a id="part" aria-label="Named target">Target</a>',
      ].join('\n\n'),
    )

    expect(screen.getByRole('link', { name: 'Titled' })).toHaveAttribute(
      'title',
      'Local title',
    )
    const target = container.querySelector('a#user-content-part')
    expect(target).toHaveAttribute('aria-label', 'Named target')
  })

  it('removes navigation from dangerous and workspace-escaping links', () => {
    renderPreview(
      [
        '[Script](javascript:alert(1))',
        '[File](file:///tmp/private.md)',
        '[Data](data:text/html;base64,SGk=)',
        '[Escape](../../outside.md)',
        '[Ordinary](notes.txt)',
      ].join(' '),
    )

    expect(screen.getByText('Script')).not.toHaveAttribute('href')
    expect(screen.getByText('File')).not.toHaveAttribute('href')
    expect(screen.getByText('Data')).not.toHaveAttribute('href')
    expect(screen.getByText('Escape')).not.toHaveAttribute('href')
    expect(screen.getByRole('link', { name: 'Ordinary' })).toHaveAttribute('href', 'notes.txt')
  })

  it('does not revoke local image URLs when the preview unmounts', async () => {
    const { registry, urlApi } = createRegistry()
    registry.register('docs/asset.png', new File(['asset'], 'asset.png'))
    const preview = renderPreview('![Asset](asset.png)', { registry })
    await screen.findByRole('img', { name: 'Asset' })

    preview.unmount()

    await waitFor(() => expect(urlApi.revokeObjectURL).not.toHaveBeenCalled())
  })
})
