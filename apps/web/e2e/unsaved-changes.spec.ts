import { expect, test, type Page } from '@playwright/test'

// «يومي» is a destination in both navigation surfaces: the rail on desktop and the drawer on a phone.
async function goToday(page: Page, width: number) {
  if (width < 768) {
    // The drawer stays open under the guard, so open it only when it is closed.
    if (!await page.locator('#mobile-navigation').isVisible()) await page.getByTestId('mobile-navigation-trigger').click()
    await page.locator('#mobile-navigation').getByRole('link', { name: 'يومي', exact: true }).click()
    return
  }
  await page.getByTestId('module-rail').getByRole('link', { name: 'يومي', exact: true }).click()
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
    await page.goto('/settings/company#branding')
    const color = page.getByTestId('branding-color')
    const saved = await color.inputValue()
    const draft = saved === '#abcdef' ? '#123456' : '#abcdef'
    await color.fill(draft)
    await goToday(page, width)
    const dialog = page.getByRole('dialog', { name: 'تغييرات غير محفوظة', exact: true })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2)
    expect(Math.abs(box!.y + box!.height / 2 - 844 / 2)).toBeLessThan(2)
    await expect(dialog.getByRole('button', { name: 'البقاء في الصفحة' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    if (width >= 768) await expect(page.getByTestId('module-rail').getByRole('link', { name: 'يومي', exact: true })).toBeFocused()
    await expect(color).toHaveValue(draft)
    await goToday(page, width)
    await dialog.getByRole('button', { name: 'البقاء في الصفحة' }).click()
    await expect(page).toHaveURL(/\/settings\/company#branding$/)
    await expect(color).toHaveValue(draft)
    await goToday(page, width)
    await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/settings/company#branding')
    await expect(color).toHaveValue(saved)

    // The same guard also protects non-branding forms, with no data writes.
    await page.goto('/settings/team/roles/new')
    await page.getByLabel('الاسم بالعربية').fill('مسودة دور')
    // The routed create panel makes the shell inert; its own close action leaves the draft.
    await page.getByRole('dialog', { name: 'إنشاء دور مخصص', exact: true }).getByRole('button', { name: 'إغلاق', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
    await expect(page).toHaveURL(/\/settings\/team\/roles$/)
  })
}
