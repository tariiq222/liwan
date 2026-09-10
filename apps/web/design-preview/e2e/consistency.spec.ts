import { test, expect } from '@playwright/test'

for (const locale of ['ar', 'en']) {
  for (const mode of ['light', 'cream', 'dark']) {
    test(`shared colors and progress endpoints: ${locale}/${mode}`, async ({ page, context }) => {
      await context.addCookies([
        { name: 'nasq-design-brand', value: '#100060', url: 'http://127.0.0.1:4317' },
        { name: 'nasq-design-secondary', value: '#b2ff32', url: 'http://127.0.0.1:4317' },
        { name: 'nasq-design-locale', value: locale, url: 'http://127.0.0.1:4317' },
        { name: 'nasq-design-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: 'http://127.0.0.1:4317' },
      ])
      await page.goto('/list')
      await expect(page.locator('fieldset')).toBeEnabled()
      const active = page.locator('.preview-context-link[aria-current]')
      await expect(active).toHaveCSS('background-color', 'rgb(178, 255, 50)')
      await expect(active).toHaveCSS('color', 'rgb(16, 0, 96)')
      await expect(page.locator('.preview-header')).toHaveCSS('background-color', 'rgb(16, 0, 96)')
      const filter = page.getByRole('button', { name: locale === 'ar' ? 'البحث والفلاتر' : 'Search & filters', exact: true })
      await filter.hover()
      await expect(filter).toHaveCSS('background-color', 'rgb(178, 255, 50)')
      await expect(filter).toHaveCSS('color', 'rgb(16, 0, 96)')
      for (const view of ['/list', '/detail?id=101', '/components']) {
        await page.goto(view)
        await expect(page.locator('fieldset')).toBeEnabled()
        const bars = page.locator('.preview-progress:visible [role="progressbar"]')
        expect(await bars.count()).toBeGreaterThan(0)
        for (const bar of await bars.all()) {
          await expect(bar).toHaveAccessibleName(locale === 'ar' ? 'الإنجاز' : 'Progress')
          const fill = bar.locator('[data-slot="indicator"]')
          const expected = Number(await bar.getAttribute('aria-valuenow')) / 100
          if (expected === 1) {
            await expect(fill).toHaveCSS('background-image', 'none')
            await expect(fill).toHaveCSS('background-color', 'rgb(16, 0, 96)')
          } else {
            await expect(fill).toHaveCSS('background-image', `linear-gradient(to ${locale === 'ar' ? 'left' : 'right'}, rgb(178, 255, 50), rgb(16, 0, 96))`)
          }
          await expect.poll(async () => {
            const trackBox = await bar.boundingBox()
            const fillBox = await fill.boundingBox()
            return Math.abs((fillBox?.width ?? 0) / trackBox!.width - expected)
          }).toBeLessThan(.01)
          await expect(bar).toHaveCSS('height', '7px')
        }
      }
    })
  }
}

test('filter icon opens only a popover, preserves summary and clears via red trash', async ({ page }) => {
  await page.goto('/list?module=hr')
  const filter = page.getByRole('button', { name: 'البحث والفلاتر', exact: true })
  await expect(filter).toHaveText('')
  await expect(page.locator('main .preview-filter-content')).toHaveCount(0)
  await filter.click()
  const popover = page.getByRole('dialog')
  await popover.getByLabel('البحث بالاسم', { exact: true }).fill('سارة')
  await popover.getByRole('combobox', { name: 'الحالة', exact: true }).click()
  await page.getByRole('option', { name: 'قيد التنفيذ', exact: true }).click()
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(filter).toBeFocused()
  await expect(page.locator('.preview-filter-summary')).toContainText('سارة')
  await page.reload()
  await expect(page.locator('.preview-filter-summary')).toContainText('سارة')
  await filter.click()
  const clear = popover.getByRole('button', { name: 'مسح الفلاتر', exact: true })
  await expect(clear).toHaveText('')
  await expect(clear).toHaveCSS('color', 'rgb(185, 28, 28)')
  await clear.click()
  await expect(page).toHaveURL(/\/list\?module=hr$/)
  await expect(page.getByRole('status')).toContainText('6 سجلات مطابقة')
})

test('date selection, explicit clear and Escape preserve the containing sheet', async ({ page }) => {
  await page.goto('/list?panel=edit&record=101')
  const sheet = page.locator('.preview-sheet')
  const date = sheet.getByRole('button', { name: /التاريخ المستهدف/ })
  await date.click()
  const calendar = page.locator('.preview-calendar')
  await expect(calendar).toBeVisible()
  await calendar.getByRole('button', { name: /21 سبتمبر 2026/ }).click()
  await expect(date).toContainText('21')
  await expect(calendar).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await date.click()
  await page.getByRole('button', { name: 'مسح التاريخ', exact: true }).click()
  await expect(date).toContainText('اختر التاريخ')
  await date.click()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeVisible()
  await expect(date).toBeFocused()
  await sheet.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await page.getByRole('button', { name: 'تطوير تجربة المستفيد', exact: true }).click()
  await expect(page.locator('.preview-sheet dl')).toContainText('—')
})

test('fields retain one visible focus frame; controls do not share progress gradients', async ({ page }) => {
  await page.goto('/form')
  for (const field of [page.getByRole('textbox', { name: 'اسم السجل*' }), page.getByRole('textbox', { name: 'الوصف' }), page.getByRole('spinbutton', { name: 'الإنجاز' })]) {
    await expect(field).toBeEnabled()
    await field.focus()
    await expect(field).toHaveCSS('outline-style', 'solid')
    await expect(field).toHaveCSS('outline-offset', '-2px')
    await expect(field).toHaveCSS('box-shadow', 'none')
  }
  await page.getByRole('checkbox').check()
  const gradients = await page.locator('[data-slot="indicator"]').evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundImage))
  expect(gradients.every(value => value === 'none')).toBe(true)
  await page.emulateMedia({ forcedColors: 'active' })
  const name = page.getByRole('textbox', { name: 'اسم السجل*' })
  await name.focus()
  await expect(name).toHaveCSS('outline-style', 'solid')
})

for (const width of [390, 768, 1440]) {
  test(`short pages and filter popover fit viewport ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 })
    await page.goto('/list')
    await expect(page.locator('fieldset')).toBeEnabled()
    const workspace = await page.locator('.preview-workspace').boundingBox()
    expect(workspace!.y + workspace!.height).toBeGreaterThanOrEqual(1200)
    const bottom = await page.evaluate(() => getComputedStyle(document.elementFromPoint(innerWidth / 2, innerHeight - 5)!).backgroundColor)
    expect(bottom).not.toBe('rgb(24, 24, 27)')
    await page.getByRole('button', { name: 'البحث والفلاتر', exact: true }).click()
    const box = await page.locator('.preview-filter-content').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('low contrast is reported without silently modifying the selected pair', async ({ page, context }) => {
  await context.addCookies([
    { name: 'nasq-design-brand', value: '#ffff00', url: 'http://127.0.0.1:4317' },
    { name: 'nasq-design-secondary', value: '#ffffff', url: 'http://127.0.0.1:4317' },
  ])
  await page.goto('/components')
  await page.getByRole('button', { name: 'خيارات المعاينة' }).click()
  await expect(page.getByText(/التباين بين اللونين منخفض/)).toBeVisible()
  await expect(page.getByLabel('اللون الأساسي', { exact: true })).toHaveValue('#ffff00')
  await expect(page.getByLabel('اللون الثانوي', { exact: true })).toHaveValue('#ffffff')
})

for (const width of [390, 1440]) {
  test(`icon buttons are square without squaring text buttons at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    async function expectSquares() {
      const buttons = page.locator('.preview-icon-button:visible')
      expect(await buttons.count()).toBeGreaterThan(0)
      for (const button of await buttons.all()) {
        const box = await button.boundingBox()
        expect(Math.abs(box!.width - box!.height)).toBeLessThan(1)
        if (width < 768) {
          await expect(button).toHaveCSS('width', '44px')
          await expect(button).toHaveCSS('height', '44px')
        }
      }
    }
    await page.goto('/list?q=توحيد')
    await expect(page.locator('fieldset')).toBeEnabled()
    await expectSquares()
    const add = await page.getByRole('button', { name: 'إضافة سجل', exact: true }).boundingBox()
    expect(add!.width).toBeGreaterThan(add!.height)
    await page.getByRole('button', { name: 'البحث والفلاتر', exact: true }).click()
    await expectSquares()
    await page.getByRole('button', { name: 'مسح الفلاتر', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'إضافة سجل', exact: true }).click()
    await expectSquares()
    await page.locator('.preview-sheet').getByRole('button', { name: /التاريخ المستهدف/ }).click()
    await expect(page.locator('.preview-calendar')).toBeVisible()
    await expectSquares()
  })
}
