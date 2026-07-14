import { useEffect, useState } from 'react'

import { MarkdownPreview, type MarkdownPreviewProps } from './MarkdownPreview'

export function useDebouncedValue<T>(value: T, delay = 150): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    if (Object.is(value, debouncedValue)) return

    const timer = globalThis.setTimeout(() => setDebouncedValue(value), delay)
    return () => globalThis.clearTimeout(timer)
  }, [debouncedValue, delay, value])

  return debouncedValue
}

export interface DebouncedMarkdownPreviewProps extends MarkdownPreviewProps {
  documentKey: string
  delay?: number
}

function DebouncedDocumentPreview({
  markdown,
  delay,
  ...previewProps
}: Omit<DebouncedMarkdownPreviewProps, 'documentKey'>) {
  const debouncedMarkdown = useDebouncedValue(markdown, delay)

  return <MarkdownPreview {...previewProps} markdown={debouncedMarkdown} />
}

export function DebouncedMarkdownPreview({
  documentKey,
  ...props
}: DebouncedMarkdownPreviewProps) {
  return <DebouncedDocumentPreview key={documentKey} {...props} />
}
