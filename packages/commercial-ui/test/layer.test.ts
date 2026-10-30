import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const FORBIDDEN_IMPORT = /from\s+['"](?:@@?|~~?)\//
const FORBIDDEN = ['apps/', '@liwan/contracts', '$fetch(', 'useMe(', 'useApi(', '/api/', '/vendor', '/subscription', 'vendor.', 'vendor/']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('commercial-ui layer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('extends the ui layer and registers the billing components under their Shared names', async () => {
    vi.stubGlobal('defineNuxtConfig', (config: unknown) => config)
    const { default: config } = await import('../nuxt.config') as { default: { extends: string[]; components: { path: string, prefix: string, pathPrefix: boolean }[] } }
    expect(config.extends).toEqual(['@liwan/ui'])
    expect(config.components).toContainEqual(expect.objectContaining({ path: join(root, 'app/components/shared/commerce'), prefix: 'SharedCommerce', pathPrefix: false }))
    expect(config.components).toContainEqual(expect.objectContaining({ path: join(root, 'app/components/shared/data'), prefix: 'Shared', pathPrefix: false }))
  })

  it('stays presentational: no app aliases, app paths, route literals, vendor knowledge or data access', () => {
    const files = sourceFiles(join(root, 'app'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(FORBIDDEN_IMPORT.test(source), `${relative(root, file)} imports through an app alias`).toBe(false)
      for (const token of FORBIDDEN) expect(source.includes(token), `${relative(root, file)} contains ${token}`).toBe(false)
    }
  })

  it('imports nothing but the ui layer, the commercial contracts and its own files', () => {
    for (const file of sourceFiles(join(root, 'app'))) {
      const specifiers = [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map(m => m[1]!)
      for (const specifier of specifiers) {
        expect(specifier.startsWith('.') || specifier.startsWith('@liwan/ui/') || specifier === '@liwan/commercial-contracts', `${relative(root, file)} imports ${specifier}`).toBe(true)
      }
    }
  })
})
