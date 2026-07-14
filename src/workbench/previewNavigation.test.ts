import { describe, expect, it, vi } from 'vitest'

import { scrollToDocumentAnchor } from './previewNavigation'

describe('scrollToDocumentAnchor', () => {
  it('scrolls the exact anchor only inside the target document pane', () => {
    const firstPane = document.createElement('div')
    firstPane.dataset.workbenchDocumentPane = 'first'
    const firstAnchor = document.createElement('h2')
    firstAnchor.id = 'user-content-install'
    const firstScroll = vi.fn()
    firstAnchor.scrollIntoView = firstScroll
    firstPane.append(firstAnchor)

    const secondPane = document.createElement('div')
    secondPane.dataset.workbenchDocumentPane = 'second'
    const secondAnchor = document.createElement('h2')
    secondAnchor.id = 'user-content-install'
    const secondScroll = vi.fn()
    secondAnchor.scrollIntoView = secondScroll
    secondPane.append(secondAnchor)
    document.body.append(firstPane, secondPane)

    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    scrollToDocumentAnchor(
      'second',
      '#user-content-install',
      document,
      requestFrame,
    )

    expect(requestFrame).toHaveBeenCalledTimes(2)
    expect(firstScroll).not.toHaveBeenCalled()
    expect(secondScroll).toHaveBeenCalledOnce()
  })
})
