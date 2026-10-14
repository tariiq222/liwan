import { expect, test, type Page } from '@playwright/test'

async function moduleLink(page: Page, width: number, label: string) {
  if (width < 768) {
    await page.getByTestId('mobile-navigation-trigger').click()
    return page.getByRole('dialog', { name: 'القائمة', exact: true })
      .getByRole('navigation', { name: 'الموديولات', exact: true })
      .getByRole('link', { name: label, exact: true })
  }
  return page.getByTestId('module-rail').getByRole('link', { name: label, exact: true })
}

for (const width of [1440, 390]) {
  test(`unsaved confirmation stays centered, preserves drafts and confirms navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/login')
    await page.getByLabel('اسم المستخدم').fill('admin')
    await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
    const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    expect((await authenticated).status()).toBe(200)
    await expect(page).not.toHaveURL(/\/login/)
    await page.goto('/settings/branding')
    const color = page.getByTestId('branding-color')
    const saved = await color.inputValue()
    const draft = saved === '#abcdef' ? '#123456' : '#abcdef'
    await color.fill(draft)
    const projects = await moduleLink(page, width, 'المشاريع')
    await projects.click()
    const dialog = page.getByRole('dialog', { name: 'تغييرات غير محفوظة', exact: true })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2)
    expect(Math.abs(box!.y + box!.height / 2 - 844 / 2)).toBeLessThan(2)
    await expect(dialog.getByRole('button', { name: 'البقاء في الصفحة' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(projects).toBeFocused()
    await expect(color).toHaveValue(draft)
    await projects.click()
    await dialog.getByRole('button', { name: 'البقاء في الصفحة' }).click()
    await expect(page).toHaveURL(/\/settings\/branding$/)
    await expect(color).toHaveValue(draft)
    await projects.click()
    await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await page.goto('/settings/branding')
    await expect(color).toHaveValue(saved)

    // The same guard also protects non-branding forms, with no data writes.
    await page.goto('/settings/roles/new')
    await page.getByLabel('الاسم بالعربية').fill('مسودة دور')
    // The routed create panel makes the shell inert; its own close action leaves the draft.
    await page.getByRole('dialog', { name: 'إنشاء دور مخصص', exact: true }).getByRole('button', { name: 'إغلاق', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
    await expect(page).toHaveURL(/\/settings\/roles$/)
  })
}
