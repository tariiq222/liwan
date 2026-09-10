import { test, expect } from '@playwright/test'

// Kept in e2e/ so the customer app's Vitest runner does not collect browser tests.

for (const width of [1440, 390]) {
  test(`all recipes have one heading and no document overflow at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    const external: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (/hydration.*mismatch/i.test(message.text())) errors.push(message.text()) })
    page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()) })
    for (const view of ['dashboard', 'list', 'detail', 'form', 'settings', 'components']) {
      await page.goto(`/${view}`)
      await expect(page.locator('main h1')).toHaveCount(1)
      await expect(page.locator('main h1')).toBeVisible()
      // Screenshot caret styling must not mutate Reka's hidden inputs mid-hydration.
      await expect(page.locator('fieldset')).toBeEnabled()
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBe(true)
      await page.screenshot({ path: info.outputPath(`${view}-${width}.png`), fullPage: true })
    }
    expect(errors).toEqual([])
    expect(external).toEqual([])
  })
}

test('language switches direction and survives refresh', async ({ page }) => {
  await page.goto('/list')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('heading', { name: 'All records', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
})

test('filters, direct record sheets and close preserve URL context', async ({ page }) => {
  await page.goto('/list?module=projects')
  const toggle = page.getByRole('button', { name: 'البحث والفلاتر', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await page.getByLabel('البحث بالاسم', { exact: true }).fill('توحيد')
  await expect(page).toHaveURL(/q=/)
  await expect(page.getByRole('status')).toContainText('1 سجلات مطابقة')
  await toggle.click()
  await page.reload()
  await page.getByRole('button', { name: 'توحيد الخدمات الرقمية', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('q')).toBe('توحيد')
  await expect(page.getByRole('button', { name: 'توحيد الخدمات الرقمية', exact: true })).toBeVisible()
})

test('sheet form validates, protects drafts and recovers from a failed save', async ({ page }) => {
  await page.goto('/list')
  await page.getByRole('button', { name: 'إضافة سجل', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(sheet.getByText('هذا الحقل مطلوب', { exact: true })).toBeVisible()
  await sheet.getByLabel('اسم السجل', { exact: true }).fill('سجل اختبار المعاينة')
  expect(await sheet.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(50)
  await sheet.getByRole('combobox', { name: 'الحالة', exact: true }).click()
  await page.getByRole('option', { name: 'قيد التنفيذ', exact: true }).click()
  await sheet.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'لديك تغييرات غير محفوظة' })).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(sheet.getByLabel('اسم السجل', { exact: true })).toHaveValue('سجل اختبار المعاينة')
  await sheet.getByRole('checkbox', { name: 'محاكاة خطأ عند الحفظ' }).check()
  await sheet.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(sheet.getByRole('alert')).toContainText('تعذر حفظ السجل التجريبي')
  await sheet.getByRole('checkbox', { name: 'محاكاة خطأ عند الحفظ' }).uncheck()
  await sheet.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'سجل اختبار المعاينة', exact: true })).toBeVisible()
})

test('standalone form guards sidebar navigation and discards only on confirmation', async ({ page }) => {
  await page.goto('/form')
  await page.getByLabel('اسم السجل', { exact: true }).fill('مسودة')
  await page.getByRole('link', { name: 'الإعدادات', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'لديك تغييرات غير محفوظة' })).toBeVisible()
  await page.getByRole('button', { name: 'تجاهل التغييرات والمغادرة' }).click()
  await expect(page).toHaveURL(/\/settings/)
})

test('settings save and the component gallery are interactive', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('اسم مساحة العمل', { exact: true }).fill('مساحة تجريبية')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('حُفظت الإعدادات التجريبية', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'قوالب الصفحات' }).getByRole('link', { name: 'المكونات والحالات', exact: true }).click()
  await page.getByRole('button', { name: 'إجراء رئيسي', exact: true }).click()
  await expect(page.getByText('تم تنفيذ الإجراء التجريبي', { exact: true })).toBeVisible()
})

test('error retry, empty, loading and readonly states are explicit', async ({ page }) => {
  await page.goto('/list?state=error')
  await expect(page.getByRole('alert')).toContainText('تعذر تحميل البيانات')
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
  await expect(page.getByRole('table')).toBeVisible()
  await page.goto('/list?state=empty')
  await expect(page.getByRole('heading', { name: 'لا توجد سجلات مطابقة' })).toBeVisible()
  await page.goto('/list?state=loading')
  await expect(page.getByRole('status')).toContainText('جارٍ التحميل')
  await page.goto('/form?state=readonly')
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled()
})

for (const [mode, fontSize, size] of [['light', 'small', 14], ['cream', 'medium', 16], ['dark', 'large', 18]] as const) {
  test(`appearance ${mode}/${fontSize} applies to the whole reference`, async ({ page, context }) => {
    await context.addCookies([{ name: 'nasq-design-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize })), url: 'http://127.0.0.1:4317' }])
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/components')
    await expect(page.locator('html')).toHaveClass(mode)
    await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
    expect(await page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(size)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByText('بانتظار البدء', { exact: true })).toHaveCSS('color', mode === 'dark' ? 'rgb(251, 191, 36)' : 'rgb(161, 98, 7)')
    await page.getByRole('button', { name: 'خيارات المعاينة' }).click()
    await expect(page.getByLabel('اللون الأساسي', { exact: true })).toBeVisible()
    await expect(page.getByLabel('اللون الثانوي', { exact: true })).toBeVisible()
  })
}

test('light brand retains contrasting primary-button text', async ({ page, context }) => {
  await context.addCookies([{ name: 'nasq-design-brand', value: '#ffee00', url: 'http://127.0.0.1:4317' }])
  await page.goto('/components')
  const button = page.getByRole('button', { name: 'إجراء رئيسي', exact: true })
  await expect(button).toHaveCSS('background-color', 'rgb(255, 238, 0)')
  await expect(button).toHaveCSS('color', 'rgb(0, 0, 0)')
})

test('secondary colour paints secondary actions without changing status colours', async ({ page, context }) => {
  await context.addCookies([
    { name: 'nasq-design-brand', value: '#ff00aa', url: 'http://127.0.0.1:4317' },
    { name: 'nasq-design-secondary', value: '#00a3a3', url: 'http://127.0.0.1:4317' },
  ])
  await page.goto('/components')
  await expect(page.getByRole('button', { name: 'إجراء ثانوي', exact: true })).toHaveCSS('background-color', 'rgb(0, 163, 163)')
  await expect(page.getByText('بانتظار البدء', { exact: true })).toHaveCSS('color', 'rgb(161, 98, 7)')
})

test('SSR form is POST and disabled before hydration', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4317/form')
  await expect(page.locator('form')).toHaveAttribute('method', 'post')
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled()
  await context.close()
})

test('all module examples reuse the same list recipe', async ({ page }) => {
  for (const [module, title] of [['projects', 'تطوير تجربة المستفيد'], ['tasks', 'مراجعة المتطلبات'], ['meetings', 'متابعة الخطة الأسبوعية'], ['hr', 'سارة أحمد']]) {
    await page.goto(`/list?module=${module}`)
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  }
})

test('keyboard skip link, sheet Escape and trigger focus restoration', async ({ page }) => {
  await page.goto('/list')
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeEnabled()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'انتقل إلى المحتوى', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#preview-main')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'البحث والفلاتر', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  const trigger = page.getByRole('button', { name: 'إضافة سجل', exact: true })
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('active navigation uses a thick start-edge line in both shared navigations', async ({ page, context }) => {
  for (const locale of ['ar', 'en']) {
    await context.addCookies([{ name: 'nasq-design-locale', value: locale, url: 'http://127.0.0.1:4317' }])
    for (const width of [1440, 768]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/list?module=projects')
      for (const selector of ['.preview-context-link', '.preview-rail-button']) {
        const active = page.locator(`${selector}[aria-current="page"]`)
        await expect(active).toHaveCount(1)
        const style = await active.evaluate(element => {
          const line = getComputedStyle(element, '::after')
          return { content: line.content, width: line.width, start: line.insetInlineStart,
            clip: line.clipPath, color: line.backgroundColor, ink: getComputedStyle(element).color }
        })
        expect(style.content).toBe('""')
        expect(style.width).toBe('4px')
        expect(style.start).toBe('0px')
        expect(style.clip === 'none' || style.clip === '').toBe(true)
        expect(style.color).not.toBe('rgba(0, 0, 0, 0)')
        if (selector === '.preview-context-link') expect(style.color).toBe(style.ink)
        expect(await page.locator(`${selector}:not([aria-current])`).first().evaluate(element => getComputedStyle(element, '::after').content)).toBe('none')
      }
    }
  }
})

test('date field opens one themed calendar without a native double frame', async ({ page }) => {
  await page.goto('/form?id=101')
  const title = page.getByRole('textbox', { name: /اسم السجل|Record name/ })
  await expect(title).toBeEnabled()
  await title.focus()
  const field = await title.evaluate(element => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle, offset: style.outlineOffset }
  })
  expect(field.outline).toBe('solid')
  expect(field.offset).toBe('-2px')
  await expect(page.locator('input[type="date"]')).toHaveCount(0)
  await page.getByRole('button', { name: /2026/ }).click()
  const calendar = page.getByRole('dialog')
  await expect(calendar).toBeVisible()
  const selected = calendar.getByRole('gridcell', { selected: true })
  await expect(selected).toHaveCount(1)
  const box = await selected.getByRole('button').evaluate(element => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle, outlineWidth: style.outlineWidth, shadow: style.boxShadow, border: style.borderWidth }
  })
  // Selected cells keep a single in-place keyboard focus frame.
  expect(['none', 'solid']).toContain(box.outline)
  expect(box.shadow === 'none' || box.shadow === '').toBe(true)
  expect(box.border === '0px' || box.border === '').toBe(true)
})
