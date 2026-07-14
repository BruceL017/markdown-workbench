import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import type { AssetRegistry } from '../files/assetRegistry'
import { resolveResourceTarget } from '../files/virtualPath'

export interface MarkdownPreviewProps {
  markdown: string
  currentDocumentPath: string
  assetRegistry: AssetRegistry
  ariaLabel?: string
  onOpenDocument?: (path: string, hash?: string) => void
}

const removedTags = new Set(['picture', 'source'])

function protocolVariants(protocol: string) {
  let variants = ['']
  for (const character of protocol) {
    variants = variants.flatMap((prefix) => [
      `${prefix}${character.toLowerCase()}`,
      `${prefix}${character.toUpperCase()}`,
    ])
  }
  return variants
}

const webProtocols = [...protocolVariants('http'), ...protocolVariants('https')]
const semanticLinkProtocols = [
  ...protocolVariants('irc'),
  ...protocolVariants('ircs'),
  ...protocolVariants('mailto'),
  ...protocolVariants('xmpp'),
]

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []).filter((tagName) => !removedTags.has(tagName)),
    'mark',
  ],
  attributes: {
    '*': ['ariaLabel', 'ariaHidden', 'id', 'title'],
    a: ['href'],
    blockquote: ['cite'],
    code: [
      ['className', /^language-[a-z0-9_+-]+$/i, 'no-highlight', 'nohighlight', 'hljs'],
    ],
    del: ['cite'],
    details: ['open'],
    img: ['alt', 'height', 'src', 'width'],
    input: [['type', 'checkbox'], ['disabled', true], 'checked'],
    li: [['className', 'task-list-item']],
    ol: ['start', ['className', 'contains-task-list']],
    span: [['className', /^hljs-[a-z0-9_-]+$/i]],
    td: ['align', 'colSpan', 'rowSpan'],
    th: ['align', 'colSpan', 'rowSpan', 'scope'],
    ul: [['className', 'contains-task-list']],
  },
  protocols: {
    cite: webProtocols,
    href: [...webProtocols, ...semanticLinkProtocols],
    src: [...webProtocols, ...protocolVariants('data')],
  },
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
}

const safeDataImagePattern =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i
const allowedSemanticSchemes = /^(?:irc|ircs|mailto|xmpp):/i
const explicitSchemePattern = /^[a-z][a-z\d+.-]*:/i

type ImageTarget =
  | { kind: 'remote'; src: string }
  | { kind: 'data'; src: string }
  | { kind: 'local'; path: string }
  | { kind: 'rejected' }

interface PreviewImageProps {
  src?: string
  alt?: string
  title?: string
  width?: number | string
  height?: number | string
  currentDocumentPath: string
  assetRegistry: AssetRegistry
}

interface LocalImageState {
  key: string
  status: 'loading' | 'missing' | 'ready'
  src?: string
}

function imageTarget(currentDocumentPath: string, rawSource: string): ImageTarget {
  const source = rawSource.trim()
  if (safeDataImagePattern.test(source)) return { kind: 'data', src: source }
  if (source.toLowerCase().startsWith('data:')) return { kind: 'rejected' }

  const target = resolveResourceTarget(currentDocumentPath, source)
  if (target.kind === 'remote') return { kind: 'remote', src: target.url }
  if (target.kind === 'local') return { kind: 'local', path: target.path }
  return { kind: 'rejected' }
}

function ImagePlaceholder({ alt, loading }: { alt: string; loading?: boolean }) {
  const name = alt || 'Image'

  return loading ? (
    <span
      className="markdown-image-placeholder"
      role="status"
      aria-label={`Loading ${name} image`}
    >
      Loading image…
    </span>
  ) : (
    <span
      className="markdown-image-placeholder"
      role="img"
      aria-label={`${name} image unavailable`}
    >
      {name} image unavailable
    </span>
  )
}

function PreviewImage({
  src = '',
  alt = '',
  title,
  width,
  height,
  currentDocumentPath,
  assetRegistry,
}: PreviewImageProps) {
  const target = useMemo(
    () => imageTarget(currentDocumentPath, src),
    [currentDocumentPath, src],
  )
  const localKey = target.kind === 'local' ? target.path : ''
  const [localImage, setLocalImage] = useState<LocalImageState>({
    key: localKey,
    status: 'loading',
  })

  useEffect(() => {
    if (target.kind !== 'local') return

    let active = true
    const key = target.path
    setLocalImage({ key, status: 'loading' })

    void assetRegistry.resolve(target.path).then(
      (resolvedSource) => {
        if (!active) return
        setLocalImage(
          resolvedSource
            ? { key, status: 'ready', src: resolvedSource }
            : { key, status: 'missing' },
        )
      },
      () => {
        if (active) setLocalImage({ key, status: 'missing' })
      },
    )

    return () => {
      active = false
    }
  }, [assetRegistry, target])

  if (target.kind === 'rejected') return <ImagePlaceholder alt={alt} />

  if (target.kind === 'local') {
    if (localImage.key !== target.path || localImage.status === 'loading') {
      return <ImagePlaceholder alt={alt} loading />
    }
    if (localImage.status === 'missing' || !localImage.src) {
      return <ImagePlaceholder alt={alt} />
    }

    return (
      <img
        src={localImage.src}
        alt={alt}
        title={title}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <img
      src={target.src}
      alt={alt}
      title={title}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      referrerPolicy={target.kind === 'remote' ? 'no-referrer' : undefined}
    />
  )
}

function rootRelativeTarget(rawTarget: string) {
  return resolveResourceTarget('__workspace_root__.md', rawTarget.slice(1))
}

function MarkdownLink({
  href,
  children,
  id,
  title,
  ariaLabel,
  ariaHidden,
  currentDocumentPath,
  onOpenDocument,
}: {
  href?: string
  children?: ReactNode
  id?: string
  title?: string
  ariaLabel?: string
  ariaHidden?: AnchorHTMLAttributes<HTMLAnchorElement>['aria-hidden']
  currentDocumentPath: string
  onOpenDocument?: (path: string, hash?: string) => void
}) {
  const semanticProps = {
    id,
    title,
    'aria-label': ariaLabel,
    'aria-hidden': ariaHidden,
  }

  if (!href) return <a {...semanticProps}>{children}</a>

  const targetValue = href.trim()
  if (targetValue.startsWith('#')) {
    return <a {...semanticProps} href={targetValue}>{children}</a>
  }

  const target = targetValue.startsWith('/')
    ? rootRelativeTarget(targetValue)
    : resolveResourceTarget(currentDocumentPath, targetValue)

  if (target.kind === 'remote') {
    return (
      <a
        {...semanticProps}
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  }

  if (allowedSemanticSchemes.test(targetValue)) {
    return <a {...semanticProps} href={targetValue}>{children}</a>
  }

  if (target.kind === 'rejected' || explicitSchemePattern.test(targetValue)) {
    return <a {...semanticProps}>{children}</a>
  }

  const isMarkdownDocument = /\.(?:md|markdown)$/i.test(target.path)
  const handleClick = isMarkdownDocument && onOpenDocument
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onOpenDocument(target.path, target.hash || undefined)
      }
    : undefined

  return (
    <a {...semanticProps} href={targetValue} onClick={handleClick}>
      {children}
    </a>
  )
}

export function MarkdownPreview({
  markdown,
  currentDocumentPath,
  assetRegistry,
  ariaLabel = 'Markdown preview',
  onOpenDocument,
}: MarkdownPreviewProps) {
  const components = useMemo<Components>(
    () => ({
      img: ({ node: _node, src, alt, title, width, height }) => (
        <PreviewImage
          src={src}
          alt={alt}
          title={title}
          width={width}
          height={height}
          currentDocumentPath={currentDocumentPath}
          assetRegistry={assetRegistry}
        />
      ),
      a: ({
        node: _node,
        href,
        children,
        id,
        title,
        'aria-label': ariaLabel,
        'aria-hidden': ariaHidden,
      }) => (
        <MarkdownLink
          href={href}
          id={id}
          title={title}
          ariaLabel={ariaLabel}
          ariaHidden={ariaHidden}
          currentDocumentPath={currentDocumentPath}
          onOpenDocument={onOpenDocument}
        >
          {children}
        </MarkdownLink>
      ),
    }),
    [assetRegistry, currentDocumentPath, onOpenDocument],
  )

  return (
    <article className="markdown-body" aria-label={ariaLabel}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeRaw, { tagfilter: true }],
          [rehypeSanitize, sanitizeSchema],
          [rehypeHighlight, { detect: false }],
        ]}
        components={components}
        urlTransform={(url) => url}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
