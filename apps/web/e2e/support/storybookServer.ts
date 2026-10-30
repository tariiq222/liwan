import { test } from '@playwright/test'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StoryEntry { id: string, type: string, title: string, name: string }

const root = fileURLToPath(new URL('../../storybook-static', import.meta.url))
const indexFile = join(root, 'index.json')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }

export const storybookBuilt = existsSync(indexFile)

export function storybookEntries(): StoryEntry[] {
  if (!storybookBuilt) return []
  return Object.values(JSON.parse(readFileSync(indexFile, 'utf8')).entries as Record<string, StoryEntry>)
}

export async function startStorybookServer(): Promise<{ base: string, close: () => Promise<void> }> {
  const server = createServer((request, response) => {
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
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return { base, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

/**
 * Call inside a `test.describe` body. Without a Storybook build the describe is
 * skipped, unless LIWAN_REQUIRE_STORYBOOK=1 (checkpoints and CI), where a missing
 * build is a failure, not a silent skip.
 */
export function requireStorybook(): void {
  if (storybookBuilt) return
  if (process.env.LIWAN_REQUIRE_STORYBOOK === '1') {
    test('Storybook build is present', () => {
      throw new Error('LIWAN_REQUIRE_STORYBOOK=1 but apps/web/storybook-static/index.json is missing. Run `npm -w apps/web run build-storybook`.')
    })
    return
  }
  test.skip(true, 'Run `npm -w apps/web run build-storybook` first.')
}
