import { expect, test } from '@playwright/test'
import { requireStorybook, startStorybookServer, storybookEntries } from './support/storybookServer'

const entries = storybookEntries()
const stories = entries.filter(entry => entry.type === 'story')
const docsEntries = entries.filter(entry => entry.type === 'docs')
const combos = ['locale:ar;appearance:light', 'locale:en;appearance:dark', 'locale:ar;appearance:dark']

let base = ''
let close: () => Promise<void> = async () => {}

test.describe('Storybook stories render without errors', () => {
  requireStorybook()

  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })

  test.afterAll(async () => { await close() })

  for (const story of stories) {
    test(story.id, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(`pageerror ${error.message}`))
      const failedRequests: { url: string, method: string, status: number }[] = []
      const consoleErrors: { text: string, url: string }[] = []
      const isExpectedFailure = (request: { url: string, method: string, status: number }) => {
        const url = new URL(request.url)
        return story.id === 'shell-globalsearch--palette-error'
          && url.origin === base && url.pathname === '/api/v1/tasks'
          && request.method === 'GET' && request.status === 500
          && url.searchParams.get('filter') === 'mine' && url.searchParams.get('q') === 'مشروع'
          && url.searchParams.get('limit') === '20' && url.searchParams.get('offset') === '0'
      }
      page.on('response', response => {
        if (response.status() >= 400) failedRequests.push({ url: response.url(), method: response.request().method(), status: response.status() })
      })
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url })
      })
      for (const globals of combos) {
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=${globals}`)
        // `toBeEmpty()` checks text content, so icon-only or skeleton-only stories
        // (no visible text, real DOM) would be misreported as empty; a rendered
        // child element is the right signal that the story actually painted.
        // A route-backed panel (SharedCreatePanel's USlideover) teleports its dialog
        // to <body>, leaving only a comment in the root; that open dialog is then the
        // painted element. Every other story still needs an element in its root.
        await expect(page.locator('#storybook-root > *, body > [role="dialog"][data-state="open"]').first()).toBeVisible({ timeout: 10_000 })
        if (story.id === 'shell-globalsearch--palette-error') {
          const recovery = page.getByText(globals.includes('locale:en') ? 'Search failed. Select to try again.' : 'تعذّر البحث. اختر للمحاولة مجددًا.', { exact: true })
          await expect(recovery).toBeVisible()
          const retry = page.waitForResponse(response => isExpectedFailure({ url: response.url(), method: response.request().method(), status: response.status() }))
          await recovery.click()
          await retry
          await expect(recovery).toBeVisible()
        }
      }
      expect(failedRequests.filter(request => !isExpectedFailure(request))).toEqual([])
      const unexpectedConsole = consoleErrors.filter(error => !(error.text === 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
        && failedRequests.some(request => request.url === error.url && isExpectedFailure(request))))
      expect([...errors, ...unexpectedConsole.map(error => `console ${error.text} (${error.url})`)]).toEqual([])
    })
  }

  for (const docsEntry of docsEntries) {
    test(`${docsEntry.id} (docs)`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(`pageerror ${error.message}`))
      page.on('console', message => { if (message.type() === 'error') errors.push(`console ${message.text()}`) })
      for (const globals of combos) {
        await page.goto(`${base}/iframe.html?id=${docsEntry.id}&viewMode=docs&globals=${globals}`)
        // The docs root holds one .sbdocs-preview block per <Canvas>; a
        // rendered one is the signal the Overview page actually painted its
        // many embedded stories, not just the surrounding docs chrome.
        await expect(page.locator('.sbdocs-content').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('.sbdocs-preview').first()).toBeVisible({ timeout: 10_000 })
      }
      expect(errors).toEqual([])
    })
  }
})
