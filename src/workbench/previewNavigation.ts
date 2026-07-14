export function scrollToDocumentAnchor(
  documentId: string,
  hash: string | undefined,
  root: Document = globalThis.document,
  requestFrame: typeof requestAnimationFrame = globalThis.requestAnimationFrame,
) {
  if (!hash?.startsWith('#')) return

  let anchorId: string
  try {
    anchorId = decodeURIComponent(hash.slice(1))
  } catch {
    return
  }

  requestFrame(() => {
    requestFrame(() => {
      const pane = Array.from(
        root.querySelectorAll<HTMLElement>('[data-workbench-document-pane]'),
      ).find((candidate) => candidate.dataset.workbenchDocumentPane === documentId)
      const anchor = pane
        ? Array.from(pane.querySelectorAll<HTMLElement>('[id]')).find(
            (candidate) => candidate.id === anchorId,
          )
        : undefined
      anchor?.scrollIntoView({ block: 'start' })
    })
  })
}
