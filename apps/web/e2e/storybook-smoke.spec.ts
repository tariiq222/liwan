import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const root = fileURLToPath(new URL('../storybook-static', import.meta.url))
const indexFile = join(root, 'index.json')
const built = existsSync(indexFile)
const stories = built
  ? Object.values(JSON.parse(readFileSync(indexFile, 'utf8')).entries as Record<string, { id: string; type: string }>).filter(entry => entry.type === 'story')
  : []
const combos = ['locale:ar;appearance:light', 'locale:en;appearance:dark', 'locale:ar;appearance:cream']
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }

let server: Server
let base = ''

test.describe('Storybook stories render without errors', () => {
  test.skip(!built, 'Run `npm -w apps/web run build-storybook` first.')

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]!)).replace(/^([/\\])+/, '')
      const file = join(root, path || 'index.html')
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
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
})
