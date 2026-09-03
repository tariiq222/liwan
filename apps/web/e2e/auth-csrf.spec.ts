import { test, expect } from '@playwright/test'

// A cross-site attacker can only reach these endpoints with a plain <form>, which
// cannot send application/json — so the media-type check is the CSRF defence.
test('a form-encoded POST to /api/auth/login is rejected with 415', async ({ page }) => {
  const res = await page.request.post('/api/auth/login', { form: { login: 'admin', password: 'admin' } })
  expect(res.status()).toBe(415)
  expect((await res.json()).data.code).toBe('unsupported_media_type')
})

test('a form-encoded POST to /api/auth/logout is rejected with 415', async ({ page }) => {
  const res = await page.request.post('/api/auth/logout', { form: {} })
  expect(res.status()).toBe(415)
})

test('a cross-site JSON POST to /api/auth/login is rejected with 403', async ({ page }) => {
  const res = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    data: { login: 'admin', password: 'admin' },
  })
  expect(res.status()).toBe(403)
  expect((await res.json()).data.code).toBe('cross_site_request')
})
