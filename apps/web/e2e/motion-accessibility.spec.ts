import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test.beforeEach(async ({ page, baseURL }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })
  expect(login.status()).toBe(200)
  expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })).status()).toBe(200)
  await page.context().addCookies([{ name: 'webvue-appearance', value: encodeURIComponent(JSON.stringify({ mode: 'light', fontSize: 'small' })), url: baseURL! }])
  await page.goto('/tasks?view=board')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-font-size', 'small')
})

test.afterEach(async ({ page }) => {
  await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
})

test('reduced motion reaches the portaled search overlay and preserves close focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('global-search-trigger').click()
  await expect(page.locator('#global-search-input')).toBeFocused()
  await expect(page.locator('.webvue-search-overlay')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.webvue-search-dialog')).toHaveCSS('animation-name', 'none')
  await page.locator('#global-search-input').fill('مشاريع')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('global-search-trigger')).toBeFocused()
  await page.getByTestId('global-search-trigger').click()
  await expect(page.locator('#global-search-input')).toHaveValue('')
})

test('assistant uses the approved text scale without changing family, primary or geometry', async ({ page }) => {
  await page.getByTestId('assistant-button').click()
  const sheet = page.getByTestId('assistant-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveCSS('width', '380px')
  await expect(page.locator('.webvue-shell-header')).toHaveCSS('height', '56px')
  await expect(page.locator('.webvue-module-rail')).toHaveCSS('width', '76px')
  await expect(page.locator('.webvue-assistant-button')).toHaveCSS('font-size', '13px')
  await expect(page.locator('.webvue-assistant-module')).toHaveCSS('font-size', '12px')
  expect(await sheet.evaluate(el => getComputedStyle(el).fontFamily)).toContain('IBM Plex Sans Arabic')
  expect(await sheet.evaluate(el => getComputedStyle(el).getPropertyValue('--primary').trim())).toBe('#5b3f8c')
  await expect(page.locator('.webvue-assistant-body')).toHaveCSS('overscroll-behavior-y', 'contain')
})

test('higher contrast uses solid material while retaining geometry', async ({ page }) => {
  await page.emulateMedia({ contrast: 'more' })
  expect(await page.locator('.webvue-shell').evaluate(el => getComputedStyle(el, '::before').backdropFilter)).toBe('none')
  await page.getByTestId('global-search-trigger').click()
  await expect(page.locator('.webvue-search-overlay')).toHaveCSS('backdrop-filter', 'none')
  await expect(page.locator('.webvue-search-dialog')).toHaveCSS('outline-width', '1px')
})

test('reduced transparency uses solid material without changing the brand', async ({ page }) => {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true)
  expect(await page.locator('.webvue-shell').evaluate(el => getComputedStyle(el, '::before').backdropFilter)).toBe('none')
  await page.getByTestId('global-search-trigger').click()
  await expect(page.locator('.webvue-search-overlay')).toHaveCSS('backdrop-filter', 'none')
  expect(await page.locator('.webvue-search-overlay').evaluate(el => getComputedStyle(el).getPropertyValue('--primary').trim())).toBe('#5b3f8c')
  await session.detach()
})

test('an open search responds to a live reduced-motion change', async ({ page }) => {
  await page.getByTestId('global-search-trigger').click()
  await page.locator('#global-search-input').fill('مشاريع')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.webvue-search-overlay')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('#global-search-input')).toHaveValue('مشاريع')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('global-search-trigger')).toBeFocused()
})

test('sheet can reverse before settling and its frames retain mirrored inline motion', async ({ page }, testInfo) => {
  const samples = await page.evaluate(async () => {
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="assistant-button"]')!
    const close = document.querySelector<HTMLButtonElement>('[data-testid="assistant-sheet-close"]')!
    const sheet = document.querySelector<HTMLElement>('[data-testid="assistant-sheet"]')!
    const samples: { time: number; x: number; opacity: number }[] = []
    trigger.click()
    setTimeout(() => close.click(), 60)
    setTimeout(() => trigger.click(), 100)
    const start = performance.now()
    await new Promise<void>(resolve => {
      const frame = (now: number) => {
        const style = getComputedStyle(sheet)
        samples.push({ time: now - start, x: parseFloat(style.translate) || 0, opacity: Number(style.opacity) })
        if (now - start < 500) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    return samples
  })
  await expect(page.getByTestId('assistant-sheet')).toBeVisible()
  await expect(page.getByTestId('assistant-button')).toHaveAttribute('aria-expanded', 'true')
  expect(samples.length).toBeGreaterThan(5)
  expect(samples.every(sample => sample.x <= 0 && sample.x >= -16 && sample.opacity >= 0 && sample.opacity <= 1)).toBe(true)
  expect(samples.at(-1)!.x).toBe(0)
  expect(samples.at(-1)!.opacity).toBe(1)
  const intervals = samples.slice(1).map((sample, index) => sample.time - samples[index]!.time).sort((a, b) => a - b)
  const evidencePath = testInfo.outputPath('sheet-frame-samples.json')
  await writeFile(evidencePath, JSON.stringify({ samples, p95FrameIntervalMs: intervals[Math.ceil(intervals.length * .95) - 1] }, null, 2))
  await testInfo.attach('sheet-frame-samples', { path: evidencePath, contentType: 'application/json' })
})

test('chosen feedback is immediate and cards can be rearranged again without a settling lock', async ({ page }) => {
  // The mock has one task per status; its unassigned personal stage puts them together for an in-column drag.
  await page.goto('/tasks?view=board&group=stage')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  const lanes = page.getByTestId('board-column')
  await expect(lanes.first()).toBeVisible()
  let lane = lanes.first()
  for (let i = 0; i < await lanes.count(); i++) {
    if (await lanes.nth(i).locator('[data-task-id][data-readonly="false"]').count() >= 2) {
      lane = lanes.nth(i)
      break
    }
  }
  const cards = lane.locator('[data-task-id][data-readonly="false"]')
  expect(await cards.count()).toBeGreaterThanOrEqual(2)
  const firstId = await cards.nth(0).getAttribute('data-task-id')
  const secondId = await cards.nth(1).getAttribute('data-task-id')
  const card = lane.locator(`[data-task-id="${firstId}"]`)
  const second = lane.locator(`[data-task-id="${secondId}"]`)
  await card.scrollIntoViewIfNeeded()
  const start = (await card.boundingBox())!
  const target = (await second.boundingBox())!
  const x = start.x + 24
  await page.mouse.move(x, start.y + start.height / 2)
  await page.mouse.down()
  // This feedback happens before mouse-up, independently of the eventual drop.
  expect(await card.evaluate(el => getComputedStyle(el).outlineWidth)).toBe('2px')
  await page.mouse.move(x, target.y + target.height - 10, { steps: 12 })
  await page.mouse.up()
  await expect(cards.nth(0)).toHaveAttribute('data-task-id', secondId!)
  // The displaced neighbour must be immediately available for another grab.
  const next = (await second.boundingBox())!
  await page.mouse.move(next.x + 24, next.y + next.height / 2)
  await page.mouse.down()
  expect(await second.evaluate(el => el.classList.contains('webvue-card-chosen'))).toBe(true)
  const back = (await card.boundingBox())!
  await page.mouse.move(next.x + 24, back.y + back.height - 10, { steps: 12 })
  await page.mouse.up()
  await expect(cards.nth(0)).toHaveAttribute('data-task-id', firstId!)
})

for (const locale of ['ar', 'en']) {
  for (const width of [390, 768, 1440]) {
    test(`assistant retains layout in ${locale} at ${width}px with large dark text`, async ({ page, baseURL }, testInfo) => {
      expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })).status()).toBe(200)
      await page.context().addCookies([
        { name: 'webvue-locale', value: locale, url: baseURL! },
        { name: 'webvue-appearance', value: encodeURIComponent(JSON.stringify({ mode: 'dark', fontSize: 'large' })), url: baseURL! },
      ])
      await page.setViewportSize({ width, height: 1000 })
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
      await expect(page.locator('html')).toHaveCSS('font-size', locale === 'ar' ? '18px' : '17px')
      await expect(page.getByTestId('assistant-button')).toBeEnabled()
      await page.getByTestId('assistant-button').click()
      const sheet = page.getByTestId('assistant-sheet')
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveCSS('opacity', '1')
      await expect(sheet).toHaveCSS('width', `${width < 768 ? width : 380}px`)
      await expect(sheet).toHaveAttribute('data-mode', width < 768 ? 'full' : width < 1100 ? 'overlay' : 'push')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await page.locator('.webvue-assistant-head').evaluate(el => {
        const head = el.getBoundingClientRect()
        return [...el.children].every(child => {
          const rect = child.getBoundingClientRect()
          return rect.left >= head.left - 1 && rect.right <= head.right + 1 && rect.bottom <= head.bottom + 1
        })
      })).toBe(true)
      expect(await sheet.evaluate(el => getComputedStyle(el).fontFamily)).toContain('IBM Plex Sans Arabic')
      expect(await sheet.evaluate(el => getComputedStyle(el).getPropertyValue('--primary').trim())).toBe('#5b3f8c')
      if (locale === 'ar' && width !== 768) await page.screenshot({ path: testInfo.outputPath(`assistant-${locale}-${width}.png`) })
    })
  }
}
