import { test, expect } from '@playwright/test'
import { BrandingSchema } from '@nasq/contracts'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const SMALL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('admin can save branding, see the live sidebar update, and reload the saved values', async ({ page }) => {
  await login(page)

  const brandingGetRes = await page.request.get('/api/v1/admin/branding')
  expect(brandingGetRes.status()).toBe(200)
  const original = BrandingSchema.parse(await brandingGetRes.json())
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = `E2E branding ${suffix}`
  const color = '#234567'
  let changed = false

  try {
    await page.goto('/settings/branding')
    await expect(page.getByTestId('branding-form')).toBeVisible()

    await page.getByTestId('branding-name').fill(name)
    await page.getByTestId('branding-color').fill(color)
    await page.getByTestId('branding-logo').setInputFiles({
      name: `e2e-branding-${suffix}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(SMALL_PNG, 'base64'),
    })
    await expect(page.getByTestId('branding-submit')).toBeEnabled()
    await expect(page.getByTestId('branding-preview')).toContainText(name)
    const previewImage = page.getByTestId('branding-preview').getByRole('img', { name })
    await expect(previewImage).toBeVisible()
    await expect.poll(() => previewImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)

    const submit = page.getByTestId('branding-submit')
    const brandingMutation = page.waitForResponse((response) => (
      response.url().includes('/api/v1/admin/branding') && response.request().method() === 'PATCH'
    ))
    await submit.click()
    const brandingMutationRes = await brandingMutation
    if (brandingMutationRes.status() === 200) changed = true
    expect(brandingMutationRes.status()).toBe(200)
    await expect(submit).toBeEnabled()

    // useUpdateBranding updates the public branding cache without navigation;
    // the sidebar image alt is a stable visible assertion of that live update.
    await expect(page.locator(`[data-sidebar="sidebar"] img[alt="${name}"]`).last()).toBeVisible()
    await expect(page.getByTestId('branding-preview')).toHaveAttribute('style', /#234567/i)

    await page.reload()
    await expect(page.getByTestId('branding-name')).toHaveValue(name)
    await expect(page.getByTestId('branding-color')).toHaveValue(color)

    const persistedRes = await page.request.get('/api/v1/admin/branding')
    expect(persistedRes.status()).toBe(200)
    const persisted = BrandingSchema.parse(await persistedRes.json())
    expect(persisted.name).toBe(name)
    expect(persisted.primary_color).toBe(color)
    expect(persisted.logo_url).toBeTruthy()
    const savedLogo = page.locator(`[data-sidebar="sidebar"] img[alt="${name}"]`).last()
    await expect.poll(() => savedLogo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  } finally {
    // Logo cleanup is intentionally out of scope; restore the mutable text and
    // colour so a local run does not affect the next admin-facing test.
    if (changed) {
      const restoreRes = await page.request.patch('/api/v1/admin/branding', {
        data: { name: original.name, primary_color: original.primary_color },
      })
      expect(restoreRes.status()).toBe(200)
      BrandingSchema.parse(await restoreRes.json())
    }
  }
})
