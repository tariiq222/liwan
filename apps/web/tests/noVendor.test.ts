import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const SCAN_ROOTS = ['app', 'server', 'i18n', 'nuxt.config.ts']
const FORBIDDEN = ['vendorWorkspace', 'useVendor', '/api/vendor', 'pages/vendor', 'vendorCapabilit', 'vendorConsole']

function sourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap(name => (name === 'node_modules' ? [] : sourceFiles(join(path, name))))
}

describe('the customer app carries no vendor console', () => {
  const files = SCAN_ROOTS.flatMap(root => sourceFiles(join(webRoot, root)))

  it('scans the app, server, locales and config', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it.each(FORBIDDEN)('has no %s reference', (needle) => {
    const hits = files.filter(file => readFileSync(file, 'utf8').includes(needle))
    expect(hits.map(file => relative(webRoot, file))).toEqual([])
  })

  it('has no vendor files or locale namespace', () => {
    const named = files.map(file => relative(webRoot, file)).filter(file => /(^|\/)vendor[-./A-Z]|useVendor|\/vendor\//i.test(file))
    expect(named).toEqual([])
  })

  it('keeps /odoo as a proxy rule only, with no navigation entry', () => {
    const nav = files.filter(file => relative(webRoot, file).startsWith(join('app', 'composables', 'nav')))
    const withOdooPath = nav.filter(file => /['"`]\/odoo\b/.test(readFileSync(file, 'utf8')))
    expect(withOdooPath.map(file => relative(webRoot, file))).toEqual([])
  })
})
