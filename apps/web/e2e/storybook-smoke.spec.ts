import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const root = fileURLToPath(new URL('../storybook-static', import.meta.url))
const indexFile = join(root, 'index.json')
const built = existsSync(indexFile)
const entries = built
  ? Object.values(JSON.parse(readFileSync(indexFile, 'utf8')).entries as Record<string, { id: string; type: string }>)
  : []
const stories = entries.filter(entry => entry.type === 'story')
const docsEntries = entries.filter(entry => entry.type === 'docs')
const combos = ['locale:ar;appearance:light', 'locale:en;appearance:dark', 'locale:ar;appearance:cream']
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }

let server: Server
let base = ''

test.describe('Storybook stories render without errors', () => {
  test.skip(!built, 'Run `npm -w apps/web run build-storybook` first.')

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      let decoded: string
      try {
        decoded = decodeURIComponent((request.url ?? '/').split('?')[0]!)
      } catch {
        // decodeURIComponent throws URIError on a malformed % escape.
        response.writeHead(400).end()
        return
      }
      const requestPath = normalize(decoded).replace(/^([/\\])+/, '')
      const file = join(root, requestPath || 'index.html')
      // A plain `file.startsWith(root)` would also match a sibling directory
      // that merely shares the root's path as a prefix (e.g. `${root}-evil`);
      // path.relative + an absolute/".." check is the safe containment test.
      const rel = relative(root, file)
      const inRoot = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
      if (!inRoot || !existsSync(file) || statSync(file).isDirectory()) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      createReadStream(file).pipe(response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  for (const story of stories) {
    test(story.id, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(`pageerror ${error.message}`))
      page.on('console', message => { if (message.type() === 'error') errors.push(`console ${message.text()}`) })
      for (const globals of combos) {
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=${globals}`)
        // `toBeEmpty()` checks text content, so icon-only or skeleton-only stories
        // (no visible text, real DOM) would be misreported as empty; a rendered
        // child element is the right signal that the story actually painted.
        await expect(page.locator('#storybook-root').locator(':scope > *').first()).toBeVisible({ timeout: 10_000 })
      }
      expect(errors).toEqual([])
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
