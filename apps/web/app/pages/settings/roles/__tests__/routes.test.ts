import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = ['index.vue', 'new.vue', '[roleId]/index.vue', '[roleId]/edit.vue']

describe('settings roles routes', () => {
  it.each(ROUTES)('defines /settings/roles route file %s', (routeFile) => {
    const path = join(import.meta.dirname, '..', routeFile)
    expect(existsSync(path), `missing roles route ${routeFile}`).toBe(true)
  })

  it('uses the capability gate and shared page contracts on every roles route', () => {
    const directory = join(import.meta.dirname, '..')
    const sources = ROUTES.filter((routeFile) => existsSync(join(directory, routeFile)))
      .map((routeFile) => readFileSync(join(directory, routeFile), 'utf8'))
      .join('\n')
    expect(sources).toContain('useAccess()')
    expect(sources).toMatch(/SharedPageHeader/)
    expect(sources).toMatch(/SharedPageState/)
    expect(sources).toMatch(/access\.roles\.read|access\.roles\.manage/)
    expect(sources).toMatch(/expected_version|conflict|current_version|reload/i)
  })

  it('exposes a complete role assignment path when the first page is truncated', () => {
    const source = readFileSync(join(import.meta.dirname, '..', '[roleId]/index.vue'), 'utf8')
    expect(source).toContain('limit: ADMIN_PAGE_SIZE')
    expect(source).toContain('assignedUsers.data.value.total > assignedUsers.data.value.items.length')
    expect(source).toContain("path: '/settings/users'")
  })
})
