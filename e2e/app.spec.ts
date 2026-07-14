import { expect, test } from '@playwright/test'

test('shows the accessible workspace placeholder', async ({ page }) => {
  await page.goto('/')

  const workspace = page.getByRole('main', { name: 'Markdown Workbench' })

  await expect(workspace).toBeVisible()
  await expect(workspace.getByRole('status')).toHaveText('正在准备工作区')
})
