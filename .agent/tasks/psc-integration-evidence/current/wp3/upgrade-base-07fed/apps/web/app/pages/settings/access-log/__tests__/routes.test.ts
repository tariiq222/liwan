import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = ['index.vue', '[eventId].vue']

describe('settings access-log routes', () => {
  it.each(ROUTES)('defines /settings/access-log route file %s', (routeFile) => {
    expect(existsSync(join(import.meta.dirname, '..', routeFile)), `missing access-log route ${routeFile}`).toBe(true)
  })

  it('uses the independent audit capability and keeps the detail values safe', () => {
    const directory = join(import.meta.dirname, '..')
    const sources = ROUTES.filter((routeFile) => existsSync(join(directory, routeFile)))
      .map((routeFile) => readFileSync(join(directory, routeFile), 'utf8'))
      .join('\n')
    expect(sources).toContain('useAccess()')
    expect(sources).toMatch(/SharedPageHeader/)
    expect(sources).toMatch(/SharedPageState/)
    expect(sources).toContain('access.audit.read')
    expect(sources).toMatch(/occurred_at|actor|target|result/)
    expect(sources).not.toMatch(/\{\{[^}]*\b(password|password_hash|session_id|token|hash)\b[^}]*\}\}/i)
  })
})
