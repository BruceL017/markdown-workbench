import { expect, test } from '@playwright/test'

test('shows the local-first shell and temporary file drawer', async ({ page }) => {
  await page.goto('/')

  const workspace = page.getByRole('main', { name: 'Markdown Workbench' })
  await expect(workspace).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open local Markdown' })).toBeVisible()
  await expect(page.getByText(/never uploaded/i)).toBeVisible()

  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Local files' })).toBeVisible()
  await page.getByRole('button', { name: 'Close file drawer', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Local files' })).toBeHidden()
})

test('opens a Markdown file through the compatibility picker', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
  })
  await page.goto('/')

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open files' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'smoke.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Local smoke note\n\nOnly in this browser.'),
  })

  await expect(page.getByRole('article', { name: 'Preview smoke.md' })).toContainText(
    'Local smoke note',
  )
  await page.getByRole('button', { name: 'Show source for smoke.md' }).click()
  await expect(page.getByRole('textbox', { name: 'Edit smoke.md' })).toBeVisible()
})
