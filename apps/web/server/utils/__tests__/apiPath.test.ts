import { expect, it } from 'vitest'
import { canonicalApiPath } from '../apiPath'
import { heavyRouteKind } from '../heavyRoutes'

const BASE = '/api/v1/finance/reports/trial-balance'

it.each([
  [BASE, BASE],
  ['/api/v1/finance/reports/trial%2Dbalance', BASE],
  ['/api/v1/finance/reports/trial%2dbalance', BASE],
  ['/api/v1/finance/reports/%74rial-balance', BASE],
  ['/api/v1/finance/reports/trial%2Ebalance', '/api/v1/finance/reports/trial.balance'],
  ['/api/v1/finance/invoices/%33/post', '/api/v1/finance/invoices/3/post'],
  ['/api/v1/finance/reports/vat%5Freturn%7E', '/api/v1/finance/reports/vat_return~'],
  [`${BASE}/`, BASE],
  ['/api/v1/finance/invoices/%33/post/', '/api/v1/finance/invoices/3/post'],
  // Only one trailing slash goes; the prefix itself is never emptied.
  ['/api/v1/', '/api/v1/'],
  // The query string is forwarded byte for byte, whatever it contains.
  [`${BASE}/?a=%2F%5c%zz&b=//x/`, `${BASE}?a=%2F%5c%zz&b=//x/`],
  [`${BASE}?date=2026-01-01&x=%33`, `${BASE}?date=2026-01-01&x=%33`],
  // Escapes of other characters are not unreserved and are left alone.
  ['/api/v1/tasks/a%20b', '/api/v1/tasks/a%20b'],
  ['/api/v1/tasks/%C3%A9', '/api/v1/tasks/%C3%A9'],
  // Paths outside the API are not this function's business.
  ['/dashboard/%2F%zz//', '/dashboard/%2F%zz//'],
  ['/_nuxt/x%2F', '/_nuxt/x%2F'],
])('canonicalizes %s as %s', (raw, expected) => {
  expect(canonicalApiPath(raw)).toBe(expected)
})

it.each([
  '/api/v1/finance/reports%2Ftrial-balance',
  '/api/v1/finance/reports%2ftrial-balance',
  '/api/v1/finance%5Creports/trial-balance',
  '/api/v1/finance%5creports/trial-balance',
  '/api/v1/finance\\reports/trial-balance',
  '/api/v1/finance/%252E%252E/x',
  '/api/v1/finance/%25',
  '/api/v1/finance/x%00',
  '/api/v1/finance/x%0A',
  '/api/v1/finance/x%7F',
  '/api/v1/finance/x\u0000',
  '/api/v1/finance/%zz',
  '/api/v1/finance/%2',
  '/api/v1/finance/x%',
  '/api/v1/finance//reports/trial-balance',
  '/api/v1/finance/reports/trial-balance//',
])('rejects %j with the structured 400', raw => {
  expect(() => canonicalApiPath(raw)).toThrowError(expect.objectContaining({
    statusCode: 400,
    data: { code: 'invalid_path', message: 'The request path is not valid.' },
  }))
})

// Dot segments are not rejected here: decoded they become a literal `..`, which the transport refuses.
it('decodes an encoded dot segment so the transport sees it', () => {
  expect(canonicalApiPath('/api/v1/finance/%2E%2E/x')).toBe('/api/v1/finance/../x')
})

// What is classified must be what Odoo receives, so every spelling of a heavy route classifies the same.
it.each([BASE, `${BASE}/`, '/api/v1/finance/reports/trial%2Dbalance', '/api/v1/finance/reports/%74rial-balance/?hold=1'])('classifies %s as a heavy read after canonicalization', raw => {
  const canonical = canonicalApiPath(raw)
  expect(heavyRouteKind('GET', canonical.split('?')[0]!)).toBe('read')
  expect(canonical.startsWith(BASE)).toBe(true)
  expect(canonical.endsWith('/')).toBe(false)
})
it('classifies an encoded invoice id as a heavy write after canonicalization', () => {
  expect(heavyRouteKind('POST', canonicalApiPath('/api/v1/finance/invoices/%33/post/'))).toBe('write')
})
