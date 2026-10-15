import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Requires isolated synthetic project API')

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login/)
})

async function appearance(page: Page, mode: string, fontSize = 'small') {
  // The server preference owns appearance; a cookie is only the previous paint.
  const saved = await page.request.patch('/api/v1/me/appearance', { data: { mode, font_size: fontSize } })
  expect(saved.status(), 'Requires isolated synthetic API with saved appearance').toBe(200)
  await page.goto('/projects/1/tasks')
  await expect(page.locator('main tbody tr')).toHaveCount(4)
  await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
  if (mode === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
  else await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.evaluate(() => document.fonts.ready)
}

// Measure rendered/composited colors, including color-mix and alpha surfaces.
function measureReadability(elements: Element[]) {
    const context = document.createElement('canvas').getContext('2d')!
    function rgba(color: string) {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data).map(value => value / 255)
    }
    function over(top: number[], bottom: number[]) { return top.slice(0, 3).map((v, i) => v * top[3]! + bottom[i]! * (1 - top[3]!)).concat(1) }
    function luminance(rgb: number[]) {
      const values = rgb.slice(0, 3).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722
    }
    return elements.map(element => {
      const ancestors: Element[] = []
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node)
      const background = ancestors.reduce((bg, node) => over(rgba(getComputedStyle(node).backgroundColor), bg), [1, 1, 1, 1])
      const style = getComputedStyle(element)
      const fg = luminance(over(rgba(style.color), background)), bg = luminance(background)
      return { tag: element.tagName.toLowerCase(), text: element.textContent?.trim(), ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), fontSize: parseFloat(style.fontSize) }
    })
}

async function readability(page: Page) {
  return page.locator('main h1, main th, main [data-tone], [data-notification-preview-item] .text-xs, [data-notification-preview-item] .text-sm').evaluateAll(measureReadability)
}

for (const mode of ['light', 'dark']) {
  test(`project status and notification text stays readable in ${mode}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.route('**/api/v1/notifications?*', route => route.fulfill({ json: {
      items: [{ id: 501, kind: 'comment', task_id: 101, task_name: 'مهمة جارية', body: 'تعليق لاختبار التباين', created_at: '2026-09-07T10:00:00', is_read: false }],
      total: 1, unread_count: 1,
    } }))
    await appearance(page, mode)
    await page.getByTestId('notification-bell').click()
    await expect(page.getByTestId('notification-preview')).toBeVisible()
    // Trigger an actual failure toast through the notification workflow, with
    // the request intercepted so no synthetic or real record is mutated.
    await page.route('**/api/v1/notifications/*/read', route => route.fulfill({ status: 500, json: { code: 'server_error', message: 'تعذر تحديث الإشعار' } }))
    await page.getByTestId('notification-preview-501').click()
    await expect(page.getByText('تعذر تحديث الإشعار', { exact: true })).toBeVisible()
    const measurements = [
      ...await readability(page),
      ...await page.getByText('تعذر تحديث الإشعار', { exact: true }).evaluateAll(measureReadability),
    ]
    expect(measurements.some(item => item.text === 'تعذر تحديث الإشعار')).toBe(true)
    expect(measurements.some(item => item.text === 'تعليق جديد على مهمة')).toBe(true)
    expect(measurements.some(item => item.text === 'تعليق لاختبار التباين')).toBe(true)
    expect(measurements.some(item => item.tag === 'time' && !!item.text)).toBe(true)
    expect(measurements.length).toBeGreaterThan(15)
    for (const item of measurements) {
      expect(item.ratio, JSON.stringify(item)).toBeGreaterThanOrEqual(4.5)
      expect(item.fontSize, item.text).toBeGreaterThanOrEqual(11.99)
    }
    await info.attach('rendered-contrast', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
    await writeFile(info.outputPath('contrast.json'), JSON.stringify(measurements, null, 2))
    await page.screenshot({ path: info.outputPath(`${mode}-notifications.png`), animations: 'disabled' })
  })
}

test('project typography scales with preference and releases its scope on client navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 })
  await page.route('**/api/v1/notifications?*', route => route.fulfill({ json: {
    items: [{ id: 501, kind: 'comment', task_id: 101, task_name: 'مهمة جارية', body: 'تعليق', created_at: '2026-09-07T10:00:00', is_read: false }],
    total: 1, unread_count: 1,
  } }))
  await appearance(page, 'light', 'small')
  for (const [size, root, label] of [['small', 14, 'صغير'], ['medium', 16, 'وسط'], ['large', 18, 'كبير']] as const) {
    if (size !== 'small') {
      await page.getByTestId('account-menu').click()
      const item = page.getByRole('menuitemcheckbox', { name: label, exact: true })
      await expect(item).toBeVisible()
      await expect(item).toHaveAttribute('aria-checked', 'false')
      const saved = page.waitForResponse(response => response.url().includes('/api/v1/me/appearance') && response.request().method() === 'PATCH')
      await item.click()
      expect((await saved).status()).toBe(200)
    }
    await expect(page.locator('html')).toHaveCSS('font-size', `${root}px`)
    const title = page.locator('main h1')
    expect(await title.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(root * 20 / 14, 1)
    expect(await page.locator('main td').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(root * 13 / 14, 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByTestId('notification-bell').click()
  expect(await page.locator('[data-notification-preview-item] time').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(18 * 12 / 14, 1)
  await page.getByRole('link', { name: 'المزيد', exact: true }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.locator('html')).not.toHaveAttribute('data-project-theme')
  await page.goBack()
  await expect(page.locator('html')).not.toHaveAttribute('data-project-theme')
})
