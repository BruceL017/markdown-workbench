import { useLayoutEffect, useRef, type RefObject } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  fallbackRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  const activeElement = globalThis.document.activeElement
  const originRef = useRef<HTMLElement | null>(
    activeElement instanceof HTMLElement && activeElement !== globalThis.document.body
      ? activeElement
      : null,
  )
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector),
    )
    if (!dialog.contains(globalThis.document.activeElement)) {
      focusable()[0]?.focus()
    }

    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onEscapeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = globalThis.document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog.addEventListener('keydown', containFocus)
    return () => {
      dialog.removeEventListener('keydown', containFocus)
      const restoreFocus = () => {
        const activeModal = globalThis.document.querySelector('[aria-modal="true"]')
        if (activeModal && activeModal !== dialog) return
        if (dialog.isConnected) return
        const origin = originRef.current
        const target = origin?.isConnected ? origin : fallbackRef.current
        target?.focus()
        requestAnimationFrame(() => {
          if (target?.isConnected || globalThis.document.querySelector('[aria-modal="true"]')) {
            return
          }
          fallbackRef.current?.focus()
        })
      }
      queueMicrotask(restoreFocus)
    }
  }, [dialogRef, fallbackRef])
}
