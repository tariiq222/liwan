import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Requires isolated synthetic project API')

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
})

async function appearance(page: Page, mode: string, fontSize = 'small') {
  await page.context().addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize })), url: page.url() }])
  await page.goto('/projects/1?tab=tasks')
  await expect(page.locator('main tbody tr')).toHaveCount(4)
  if (mode !== 'light') await expect(page.locator('html')).toHaveClass(new RegExp(mode))
  await page.evaluate(() => document.fonts.ready)
}

// Measure rendered/composited colors, including color-mix and alpha surfaces.
async function readability(page: Page) {
  return page.locator('main h1, main th, main [class*="nasq-status-chip-"], [data-notification-preview-item] .text-muted-foreground, [data-sonner-toast]').evaluateAll(elements => {
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
      return { text: element.textContent?.trim(), ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), fontSize: parseFloat(style.fontSize) }
    })
  })
}

for (const mode of ['light', 'cream', 'dark']) {
  test(`project status and notification text stays readable in ${mode}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await appearance(page, mode)
    await page.getByTestId('notification-bell').click()
    await expect(page.getByTestId('notification-preview')).toBeVisible()
    // Trigger an actual failure toast through the notification workflow, with
    // the request intercepted so no synthetic or real record is mutated.
    await page.route('**/api/v1/notifications/*/read', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.getByTestId('notification-preview-501').click()
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible()
    const measurements = await readability(page)
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
  for (const [size, root] of [['small', 14], ['medium', 16], ['large', 18]] as const) {
    await appearance(page, 'light', size)
    const title = page.locator('main h1')
    expect(await title.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(root * 20 / 14, 1)
    expect(await page.locator('main td').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(root, 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByTestId('notification-bell').click()
  expect(await page.locator('[data-notification-preview-item] time').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(18 * 12 / 14, 1)
  await page.getByRole('link', { name: 'المزيد', exact: true }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.locator('html')).not.toHaveAttribute('data-project-theme')
  await page.goBack()
  await expect(page.locator('html')).toHaveAttribute('data-project-theme', 'true')
})
