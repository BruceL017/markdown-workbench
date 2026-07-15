import { useEffect, useRef, type RefObject } from 'react'

import { useWorkspaceLocale } from '../i18n/workspaceLocale'
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
  const { t } = useWorkspaceLocale()
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
        <p className="eyebrow">{t('settings.eyebrow')}</p>
        <h2 id="settings-title">{t('settings.title')}</h2>
        <ul className="privacy-list">
          <li>
            {directSave
              ? t('settings.directSave')
              : t('settings.downloadSave')}
          </li>
          <li>{t('settings.noUpload')}</li>
          <li>{t('settings.remoteImages')}</li>
          <li>{t('settings.drafts')}</li>
        </ul>
        <div className="settings-clear-row">
          <div>
            <strong>{t('settings.recoveryTitle')}</strong>
            <span>{t('settings.recoveryDescription')}</span>
          </div>
          <button type="button" className="danger-button" onClick={onClear}>
            {t('settings.clear')}
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="primary-button" autoFocus onClick={onClose}>
            {t('settings.done')}
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
  const { t } = useWorkspaceLocale()
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
        <p className="eyebrow">{t('clear.eyebrow')}</p>
        <h2 id="clear-title">{t('clear.title')}</h2>
        <p id="clear-description">
          {dirty
            ? t('clear.dirtyDescription')
            : t('clear.description')}
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
            {t('clear.cancel')}
          </button>
          <button type="button" className="danger-button" disabled={busy} onClick={onClear}>
            {busy ? t('clear.clearing') : t('clear.action')}
          </button>
        </div>
      </section>
    </div>
  )
}
