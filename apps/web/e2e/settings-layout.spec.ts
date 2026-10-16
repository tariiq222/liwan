import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

for (const width of [1440, 390]) {
  test(`settings keep controls usable and tables contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    await page.goto('/settings/branding')
    await expect(page).toHaveURL(/\/settings\/branding$/)
    await expect(page.getByTestId('branding-color')).toBeVisible()
    await expect(page.getByTestId('settings-branding-tab')).toBeVisible()
    await expect(page.locator('.webvue-settings-nav a[href="/settings/branding"]')).toHaveCount(0)
    await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })

    const rolesResponse = await page.request.get('/api/v1/admin/roles')
    const roles = (await rolesResponse.json()).items
    const role = roles.find((item: { type: string }) => item.type === 'custom') ?? roles[0]
    const usersResponse = await page.request.get('/api/v1/admin/users')
    const user = (await usersResponse.json()).items[0]
    const paths = ['/settings/branding', '/projects/settings', '/settings/users', '/settings/roles', '/settings/access-log', '/settings/users/new', '/settings/roles/new', `/settings/users/${user.id}`, `/settings/users/${user.id}/access`, `/settings/users/${user.id}/security`, `/settings/roles/${role.id}`, `/settings/roles/${role.id}/edit`]
    const auditResponse = await page.request.get('/api/v1/admin/access-log?limit=1')
    const audit = (await auditResponse.json()).items[0]
    expect(audit).toBeTruthy()
    paths.push(`/settings/access-log/${audit.id}`)
    for (const path of paths) {
      await page.goto(path)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(page.locator('h1')).not.toBeEmpty()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      expect(overflow, `${path} must not scroll horizontally as a page`).toBe(false)
      const filters = page.locator('.webvue-settings-filters')
      if (await filters.count()) {
        const controls = filters.locator('input, select')
        await expect(controls.first()).toBeVisible()
        for (const control of await controls.all()) {
          const box = await control.boundingBox()
          expect(box?.height).toBe(40)
          expect(box!.width).toBeGreaterThan(150)
          await expect(control).toHaveAccessibleName(/.+/)
        }
      }
    }
  })
}
