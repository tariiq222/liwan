import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = [
  'index.vue',
  'new.vue',
  '[userId]/index.vue',
  '[userId]/access.vue',
  '[userId]/security.vue',
]

describe('settings users routes', () => {
  it.each(ROUTES)('defines /settings/users route file %s', (routeFile) => {
    const path = join(import.meta.dirname, '..', routeFile)
    expect(existsSync(path), `missing users route ${routeFile}`).toBe(true)
  })

  it('uses the capability gate and shared page contracts on every users route', () => {
    const directory = join(import.meta.dirname, '..')
    const sources = ROUTES.filter((routeFile) => existsSync(join(directory, routeFile)))
      .map((routeFile) => readFileSync(join(directory, routeFile), 'utf8'))
      .join('\n')
    expect(sources).toContain('useAccess()')
    expect(sources).toMatch(/SharedPageHeader/)
    expect(sources).toMatch(/SharedPageState/)
    expect(sources).toMatch(/access\.users\.read|access\.users\.grant|access\.users\.assign_roles/)
  })
})
