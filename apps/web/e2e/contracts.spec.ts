import { test, expect } from '@playwright/test'
import { BrandingSchema, MeSchema } from '@nasq/contracts'

// The zod schemas and the Odoo serializers are written independently; only a
// round trip against the live API proves they still describe the same payload.
test('GET /api/v1/branding matches BrandingSchema', async ({ page }) => {
  const res = await page.request.get('/api/v1/branding')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(() => BrandingSchema.parse(body)).not.toThrow()
})

test('GET /api/v1/me matches MeSchema', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  // the request context keeps the session cookie the login handed back
  const res = await page.request.get('/api/v1/me')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(() => MeSchema.parse(body)).not.toThrow()
})
