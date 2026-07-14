import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface FilePayload {
  name: string
  mimeType: string
  buffer: Buffer
}

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xx2YVQAAAABJRU5ErkJggg==',
  'base64',
)

async function useFallbackMode(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })
}

async function openFiles(page: Page, files: FilePayload[]) {
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open files' }).first().click()
  const chooser = await chooserPromise
  await chooser.setFiles(files)
  if (files.length > 1) {
    await expect(page.getByRole('dialog', { name: 'Local files' })).toBeVisible()
  }
}

async function openDrawer(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Local files' })
  if (!(await drawer.isVisible())) {
    await page.getByRole('button', { name: 'Files', exact: true }).click()
  }
  await expect(drawer).toBeVisible()
  return drawer
}

async function splitFromDrawer(
  page: Page,
  filename: string,
  direction: 'left' | 'right' | 'top' | 'bottom',
) {
  const drawer = await openDrawer(page)
  await drawer.getByRole('button', {
    name: `Open ${filename} in ${direction} split`,
  }).click()
  await expect(drawer).toBeHidden()
}

async function focusFromDrawer(page: Page, filename: string) {
  const drawer = await openDrawer(page)
  await drawer.getByRole('button', { name: `Open ${filename}`, exact: true }).click()
  await expect(drawer).toBeHidden()
}

async function expectAxeClean(page: Page, state: string) {
  const result = await new AxeBuilder({ page })
    .withTags([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22a',
      'wcag22aa',
    ])
    .analyze()
  const details = result.violations
    .map((violation) => `${violation.id}: ${violation.nodes.length} node(s) — ${violation.help}`)
    .join('\n')
  expect(result.violations, `${state} accessibility violations:\n${details}`).toEqual([])
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
}

async function dragFirstSplitter(page: Page, distance = 70) {
  const splitter = page.locator('.flexlayout__splitter:visible').first()
  const box = await splitter.boundingBox()
  if (!box) throw new Error('Expected a visible FlexLayout splitter')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const end = box.width < box.height
    ? { x: start.x + distance, y: start.y }
    : { x: start.x, y: start.y + distance }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await useFallbackMode(page)
})

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

test('fallback flow opens both Markdown extensions, buffers, edits, previews, and downloads', async ({ page }) => {
  await page.goto('/')
  await openFiles(page, [
    {
      name: 'first.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# First note'),
    },
    {
      name: 'second.markdown',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Second note'),
    },
  ])

  const drawer = page.getByRole('dialog', { name: 'Local files' })
  await expect(drawer.getByRole('button', {
    name: 'Open second.markdown',
    exact: true,
  })).toBeVisible()
  await drawer.getByRole('button', { name: 'Open second.markdown in right split' }).click()
  await expect(page.locator('[data-workbench-document-pane]')).toHaveCount(2)

  await page.getByRole('button', { name: 'Show source for first.md' }).click()
  const editor = page.getByRole('textbox', { name: 'Edit first.md' })
  await editor.fill('# Edited locally\n\nCompatibility flow.')
  await page.getByRole('button', { name: 'Show preview for first.md' }).click()
  await expect(page.getByRole('article', { name: 'Preview first.md' })).toContainText(
    'Compatibility flow.',
  )

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save first.md' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('first.md')
  await expect(page.getByText('Download started for first.md.')).toBeVisible()
})

test('restores fallback drafts, desktop layout, and theme, then clears recovery data', async ({ page }) => {
  await page.goto('/')
  await openFiles(page, [
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

test('fallback folder resolves a local PNG and same-pane internal Markdown link', async ({ page, browserName }, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'Synthetic webkitdirectory traversal is only stable in Chromium; path, asset, and link behavior remains unit-tested for Firefox/WebKit.',
  )
  const fixtureDirectory = testInfo.outputPath('folder-fixture')
  await mkdir(join(fixtureDirectory, 'images'), { recursive: true })
  await Promise.all([
    writeFile(
      join(fixtureDirectory, 'README.md'),
      '# Folder home\n\n[Guide](guide.markdown#target)\n\n![Pixel](images/pixel.png)',
    ),
    writeFile(
      join(fixtureDirectory, 'guide.markdown'),
      '<h2 id="target">Target section</h2>',
    ),
    writeFile(join(fixtureDirectory, 'images/pixel.png'), transparentPng),
  ])
  await page.goto('/')
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open folder' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(fixtureDirectory)

  await expect(page.getByRole('img', { name: 'Pixel' })).toHaveAttribute('src', /^blob:/)
  await page.getByRole('button', { name: 'Close file drawer', exact: true }).click()
  await page.getByRole('link', { name: 'Guide' }).click()
  await expect(page.getByRole('article', { name: 'Preview guide.markdown' })).toContainText(
    'Target section',
  )
  await expect(page.locator('#user-content-target')).toBeVisible()
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(1)
})

test('drawer drag creates an edge pane while visible documents never duplicate', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'HTML drag geometry is verified once in Chromium.')
  await page.goto('/')
  await openFiles(page, [
    { name: 'first.md', mimeType: 'text/markdown', buffer: Buffer.from('# First') },
    { name: 'second.md', mimeType: 'text/markdown', buffer: Buffer.from('# Second') },
  ])

  const drawer = page.getByRole('dialog', { name: 'Local files' })
  const source = drawer.getByRole('button', { name: 'Open second.md', exact: true })
  await expect(source).toHaveAttribute('draggable', 'true')
  const target = page.locator('.flexlayout__layout')
  const targetBox = await target.boundingBox()
  const sourceBox = await source.boundingBox()
  if (!targetBox) throw new Error('Expected the desktop layout')
  if (!sourceBox) throw new Error('Expected a drawer drag source')
  const sourcePoint = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  }
  await page.mouse.move(sourcePoint.x, sourcePoint.y)
  await page.mouse.down()
  await page.mouse.move(sourcePoint.x + 12, sourcePoint.y, { steps: 3 })
  await expect(page.locator('.drawer-layer.is-dragging')).toBeAttached()
  await page.mouse.move(
    targetBox.x + targetBox.width - 5,
    targetBox.y + targetBox.height / 2,
    { steps: 12 },
  )
  await page.mouse.up()

  await expect(drawer).toBeHidden()
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)
  await expect(page.locator('[data-workbench-document-pane]')).toHaveCount(2)

  const reopened = await openDrawer(page)
  const visibleSecond = reopened.getByRole('button', { name: 'Open second.md', exact: true })
  await expect(visibleSecond).not.toHaveAttribute('draggable', 'true')
  await visibleSecond.click()
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)
  const ids = await page.locator('[data-workbench-document-pane]').evaluateAll((panes) =>
    panes.map((pane) => pane.getAttribute('data-workbench-document-pane')),
  )
  expect(new Set(ids).size).toBe(2)
})

test('existing tabs edge-dock and splitters resize adjacent pane geometry', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'FlexLayout pointer geometry is verified once in Chromium.')
  await page.goto('/')
  await openFiles(page, [
    { name: 'first.md', mimeType: 'text/markdown', buffer: Buffer.from('# First') },
    { name: 'second.md', mimeType: 'text/markdown', buffer: Buffer.from('# Second') },
    { name: 'third.md', mimeType: 'text/markdown', buffer: Buffer.from('# Third') },
  ])
  await splitFromDrawer(page, 'second.md', 'right')
  await splitFromDrawer(page, 'third.md', 'bottom')

  const layout = page.locator('.flexlayout__layout')
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('Expected the desktop layout')
  const firstTab = page.locator('.flexlayout__tab_button').filter({ hasText: 'first.md' })
  const firstTabset = firstTab.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " flexlayout__tabset ")][1]',
  )
  const sourcePaneBefore = await firstTabset.boundingBox()
  if (!sourcePaneBefore) throw new Error('Expected the first document pane')
  const splitterTreeBefore = await page.locator('.flexlayout__splitter').evaluateAll((splitters) =>
    splitters.map((splitter) => splitter.className).sort(),
  )
  const firstTabBox = await firstTab.boundingBox()
  if (!firstTabBox) throw new Error('Expected the first document tab')
  const sourcePoint = {
    x: firstTabBox.x + Math.min(60, firstTabBox.width / 3),
    y: firstTabBox.y + firstTabBox.height / 2,
  }
  await page.mouse.move(sourcePoint.x, sourcePoint.y)
  await page.mouse.down()
  await page.mouse.move(sourcePoint.x + 12, sourcePoint.y + 8, { steps: 4 })
  await page.waitForTimeout(100)
  await page.mouse.move(
    layoutBox.x + layoutBox.width / 2,
    layoutBox.y + 5,
    { steps: 20 },
  )
  await page.waitForTimeout(120)
  await page.mouse.up()
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)
  const ids = await page.locator('[data-workbench-document-pane]').evaluateAll((panes) =>
    panes.map((pane) => pane.getAttribute('data-workbench-document-pane')),
  )
  expect(ids).toHaveLength(3)
  expect(new Set(ids).size).toBe(3)
  const sourcePaneAfter = await firstTabset.boundingBox()
  if (!sourcePaneAfter) throw new Error('Expected the redocked first document pane')
  expect(Math.max(
    Math.abs(sourcePaneAfter.width - sourcePaneBefore.width),
    Math.abs(sourcePaneAfter.height - sourcePaneBefore.height),
  )).toBeGreaterThan(120)
  const splitterTreeAfter = await page.locator('.flexlayout__splitter').evaluateAll((splitters) =>
    splitters.map((splitter) => splitter.className).sort(),
  )
  expect(splitterTreeAfter).not.toEqual(splitterTreeBefore)

  const before = await page.locator('.flexlayout__tabset').evaluateAll((panes) =>
    panes.map((pane) => pane.getBoundingClientRect().toJSON()),
  )
  await dragFirstSplitter(page)
  const after = await page.locator('.flexlayout__tabset').evaluateAll((panes) =>
    panes.map((pane) => pane.getBoundingClientRect().toJSON()),
  )
  expect(after.some((rect, index) =>
    Math.abs(rect.width - before[index].width) > 20 ||
    Math.abs(rect.height - before[index].height) > 20,
  )).toBe(true)
})

test('document contents stay out of cross-origin requests and request payloads', async ({ page }) => {
  const sentinel = 'PRIVATE_MARKDOWN_SENTINEL_7cY9'
  const requests: Array<{ url: string; postData: string | null }> = []
  page.on('request', (request) => {
    requests.push({ url: request.url(), postData: request.postData() })
  })
  await page.goto('/')
  await openFiles(page, [{
    name: 'private.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Private\n\n${sentinel}`),
  }])
  await page.getByRole('button', { name: 'Show source for private.md' }).click()
  await page.getByRole('textbox', { name: 'Edit private.md' }).fill(`# Edited\n\n${sentinel}`)
  await page.getByRole('button', { name: 'Show preview for private.md' }).click()
  await expect(page.getByRole('article', { name: 'Preview private.md' })).toContainText(sentinel)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save private.md' }).click()
  await downloadPromise

  const appOrigin = new URL(page.url()).origin
  expect(requests.filter((request) => new URL(request.url).origin !== appOrigin)).toEqual([])
  expect(JSON.stringify(requests)).not.toContain(sentinel)
})

test('remote images make only the disclosed no-referrer GET', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Remote-image request policy is browser-independent and verified in Chromium.')
  const sentinel = 'PRIVATE_REMOTE_SENTINEL_P4v2'
  const remoteUrl = 'https://images.example.test/pixel.png'
  const remoteRequests: Array<{ method: string; url: string; headers: Record<string, string>; postData: string | null }> = []
  await page.route(remoteUrl, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng })
  })
  page.on('request', (request) => {
    if (request.url() === remoteUrl) {
      remoteRequests.push({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        postData: request.postData(),
      })
    }
  })
  await page.goto('/')
  await openFiles(page, [{
    name: 'remote.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Remote\n\n${sentinel}\n\n![Remote pixel](${remoteUrl})`),
  }])

  await expect(page.getByRole('img', { name: 'Remote pixel' })).toBeVisible()
  await expect.poll(() => remoteRequests.length).toBe(1)
  expect(remoteRequests[0]).toMatchObject({ method: 'GET', url: remoteUrl, postData: null })
  expect(remoteRequests[0].headers.referer).toBeUndefined()
  expect(JSON.stringify(remoteRequests)).not.toContain(sentinel)
})

test('empty, drawer, multi-pane, and settings states pass axe and attach visual evidence', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Deterministic visual and axe audit runs once in Chromium.')
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expectAxeClean(page, 'empty shell')
  await attachScreenshot(page, testInfo, 'empty-shell')

  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expectAxeClean(page, 'file drawer')
  await attachScreenshot(page, testInfo, 'file-drawer')
  await page.getByRole('button', { name: 'Close file drawer', exact: true }).click()

  await openFiles(page, [
    { name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('# One') },
    { name: 'two.md', mimeType: 'text/markdown', buffer: Buffer.from('# Two') },
    { name: 'three.md', mimeType: 'text/markdown', buffer: Buffer.from('# Three') },
    { name: 'four.md', mimeType: 'text/markdown', buffer: Buffer.from('# Four') },
  ])
  await splitFromDrawer(page, 'two.md', 'right')
  await splitFromDrawer(page, 'three.md', 'bottom')
  await focusFromDrawer(page, 'one.md')
  await splitFromDrawer(page, 'four.md', 'bottom')
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(4)
  await expect(page.getByRole('group', { name: 'View one.md' })).toBeVisible()
  await expectAxeClean(page, '2x2 workspace')
  await attachScreenshot(page, testInfo, 'workspace-2x2')

  await page.getByRole('button', { name: 'Privacy and local data' }).click()
  await expect(page.getByRole('dialog', { name: 'Privacy and local data' })).toBeVisible()
  await expectAxeClean(page, 'settings modal')
  await attachScreenshot(page, testInfo, 'settings-modal')
})

test('dark theme focused skip link passes axe', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Deterministic axe audit runs once in Chromium.')
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark')
  await page.getByRole('link', { name: 'Skip to document workspace' }).focus()

  await expect(page.getByRole('link', { name: 'Skip to document workspace' })).toBeFocused()
  await expectAxeClean(page, 'dark theme focused skip link')
})

test('eight panes and a two-megabyte document remain editable and previewable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Stress acceptance runs once in Chromium.')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto('/')
  const largeText = `# Large document\n\n${'local-data '.repeat(190_000)}`
  expect(Buffer.byteLength(largeText)).toBeGreaterThan(2_000_000)
  await openFiles(page, [
    { name: 'large.md', mimeType: 'text/markdown', buffer: Buffer.from(largeText) },
    ...Array.from({ length: 7 }, (_, index) => ({
      name: `pane-${index + 2}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`# Pane ${index + 2}`),
    })),
  ])

  await splitFromDrawer(page, 'pane-2.md', 'right')
  await splitFromDrawer(page, 'pane-3.md', 'right')
  await splitFromDrawer(page, 'pane-4.md', 'right')
  await focusFromDrawer(page, 'large.md')
  await splitFromDrawer(page, 'pane-5.md', 'bottom')
  await focusFromDrawer(page, 'pane-2.md')
  await splitFromDrawer(page, 'pane-6.md', 'bottom')
  await focusFromDrawer(page, 'pane-3.md')
  await splitFromDrawer(page, 'pane-7.md', 'bottom')
  await focusFromDrawer(page, 'pane-4.md')
  await splitFromDrawer(page, 'pane-8.md', 'bottom')

  await expect(page.locator('.flexlayout__tabset')).toHaveCount(8)
  await expect(page.locator('[data-workbench-document-pane]')).toHaveCount(8)
  await dragFirstSplitter(page, 45)

  await page.getByRole('button', { name: 'Show source for large.md' }).click()
  const marker = 'STRESS_INPUT_SURVIVED_8Vw3'
  await page.getByRole('textbox', { name: 'Edit large.md' }).fill(`${largeText}\n\n${marker}`)
  await expect(page.getByRole('textbox', { name: 'Edit large.md' })).toContainText(marker)
  await page.getByRole('button', { name: 'Show preview for large.md' }).click()
  await expect(page.getByRole('article', { name: 'Preview large.md' })).toContainText(marker, {
    timeout: 30_000,
  })
})
