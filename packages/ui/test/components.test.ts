import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const FORBIDDEN = ["from '@/", "from '~/", 'apps/web', '$fetch(', 'useMe(', '/api/']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('ui layer components', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stays presentational: no app aliases, app paths or data access', () => {
    const files = sourceFiles(join(root, 'app'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const token of FORBIDDEN) expect(source.includes(token), `${relative(root, file)} contains ${token}`).toBe(false)
    }
  })

  it('registers the shared component groups with the Shared prefix and no path prefix', async () => {
    vi.stubGlobal('defineNuxtConfig', (config: unknown) => config)
    const { default: config } = await import('../nuxt.config') as { default: { components: { path: string, prefix: string, pathPrefix: boolean }[] } }
    for (const group of ['feedback', 'data', 'form', 'layout']) {
      expect(config.components).toContainEqual(expect.objectContaining({
        path: join(root, 'app/components/shared', group), prefix: 'Shared', pathPrefix: false,
      }))
    }
  })
})
