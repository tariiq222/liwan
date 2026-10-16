import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '../safeReturnTo'

describe('safeReturnTo', () => {
  it.each(['/', '/customers', '/customers?q=a b&page=2', '/tenants/12#top', '/plans/new'])('keeps the same-app path %s', (path) => {
    expect(safeReturnTo(path)).toBe(path)
  })

  it.each([
    '//evil.example', '//evil.example/path', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)',
    'https://evil.example/', 'http://evil.example', 'data:text/html,x', 'customers', '', ' /customers', '/\tcustom', '/a\nb',
    '/login', '/login?next=/x', '/enroll', '/enroll#token', `/${'a'.repeat(600)}`,
  ])('rejects %j', (value) => {
    expect(safeReturnTo(value)).toBeNull()
  })

  it.each([undefined, null, 5, {}, ['//evil.example']])('rejects the non-string %j', (value) => {
    expect(safeReturnTo(value)).toBeNull()
  })

  it('reads the first entry of a repeated query parameter', () => {
    expect(safeReturnTo(['/audit', '//evil.example'])).toBe('/audit')
  })
})
