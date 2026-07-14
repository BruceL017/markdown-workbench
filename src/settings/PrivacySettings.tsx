import { useEffect, useRef, type RefObject } from 'react'

import { useModalFocus } from '../workbench/useModalFocus'

export function SettingsDialog({
  directSave,
  onClose,
  onClear,
  returnFocusRef,
}: {
  directSave: boolean
  onClose: () => void
  onClear: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useModalFocus(dialogRef, returnFocusRef, onClose)

  return (
    <div className="dialog-layer">
      <section
        ref={dialogRef}
        className="decision-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <p className="eyebrow">Local-first</p>
        <h2 id="settings-title">Privacy and local data</h2>
        <ul className="privacy-list">
          <li>
            {directSave
              ? 'This browser can write back only to local files you approve.'
              : 'Compatibility mode saves edits by downloading a copy.'}
          </li>
          <li>No document upload or telemetry is used.</li>
          <li>Remote images in previews may contact their third-party hosts.</li>
          <li>IndexedDB drafts help with recovery; they are not a backup.</li>
        </ul>
        <div className="settings-clear-row">
          <div>
            <strong>Browser recovery data</strong>
            <span>Remove drafts, layout, preferences, and saved file permissions.</span>
          </div>
          <button type="button" className="danger-button" onClick={onClear}>
            Clear local data
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="primary-button" autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  )
}

export function ClearLocalDataDialog({
  dirty,
  busy,
  onCancel,
  onClear,
  returnFocusRef,
}: {
  dirty: boolean
  busy: boolean
  onCancel: () => void
  onClear: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useModalFocus(dialogRef, returnFocusRef, busy ? undefined : onCancel)
  useEffect(() => {
    if (busy) cancelRef.current?.focus()
  }, [busy])

  return (
    <div className="dialog-layer">
      <section
        ref={dialogRef}
        className="decision-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-title"
        aria-describedby="clear-description"
      >
        <p className="eyebrow">Browser storage</p>
        <h2 id="clear-title">Clear local data?</h2>
        <p id="clear-description">
          {dirty
            ? 'This removes recovery drafts, including unsaved changes, plus the saved layout and file permissions.'
            : 'This removes recovery drafts, the saved layout, preferences, and file permissions.'}
        </p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary-button"
            autoFocus
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onCancel()
            }}
          >
            Cancel
          </button>
          <button type="button" className="danger-button" disabled={busy} onClick={onClear}>
            {busy ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </section>
    </div>
  )
}
