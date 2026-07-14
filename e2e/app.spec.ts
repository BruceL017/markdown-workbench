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

test('restores fallback drafts, desktop layout, and theme, then clears recovery data', async ({ page }) => {
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
  await chooser.setFiles([
    {
      name: 'first.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# First note'),
    },
    {
      name: 'second.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Second note'),
    },
  ])

  const drawer = page.getByRole('dialog', { name: 'Local files' })
  await drawer.getByRole('button', { name: 'Open second.md in right split' }).click()
  await page.getByRole('button', { name: 'Show source for first.md' }).click()
  const editor = page.getByRole('textbox', { name: 'Edit first.md' })
  await editor.fill('# Recovered draft')
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark')
  await page.waitForTimeout(850)

  await page.reload()

  await expect(page.getByRole('textbox', { name: 'Edit first.md' })).toContainText(
    '# Recovered draft',
  )
  await expect(page.getByRole('article', { name: 'Preview second.md' })).toContainText(
    'Second note',
  )
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark')

  await page.getByRole('button', { name: 'Privacy and local data' }).click()
  await page.getByRole('button', { name: 'Clear local data' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Clear local data?' })
  await expect(confirmation).toContainText('unsaved changes')
  await confirmation.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByRole('heading', { name: 'Open local Markdown' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Open local Markdown' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('system')
})
