import { test, expect } from '@playwright/test'

test('SSR and client agree on shared and module surfaces', async ({ page, baseURL }, info) => {
  test.setTimeout(180_000)
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
  const errors: { url: string; message: string; nodes?: unknown[] }[] = []
  const pending: Promise<void>[] = []
  await page.addInitScript(() => {
    const warn = console.warn
    ;(window as any).__hydrationNodes = []
    console.warn = (...args) => {
      if (args.some(arg => typeof arg === 'string' && /Hydration/i.test(arg))) {
        ;(window as any).__hydrationNodes.push(args.map(arg => arg instanceof Node
          ? { type: arg.nodeType, html: (arg as Element).outerHTML, parent: arg.parentElement?.outerHTML?.slice(0, 6000) }
          : String(arg)))
      }
      warn(...args)
    }
  })
  page.on('console', msg => {
    if (!/hydration|mismatch|Failed to resolve component/i.test(msg.text())) return
    const row = { url: page.url(), message: msg.text().slice(0, 7000), nodes: [] as unknown[] }
    errors.push(row)
    pending.push(Promise.all(msg.args().map(async arg => {
      return await arg.evaluate(value => value instanceof Node
        ? ((value as Element).outerHTML || value.parentElement?.outerHTML)?.slice(0, 5000)
        : undefined).catch(() => undefined)
    })).then(nodes => { row.nodes = nodes.filter(Boolean) }))
  })
  for (const url of ['/archived-tasks', '/hr/departments/3', '/project-templates/8', '/settings/users', '/meetings/2', '/meetings/2/edit?fullPage=1', '/tasks?tab=board', '/hr/departments/999999?fullPage=1', '/projects/68/raci', '/projects/68/register/22', '/projects/68/stakeholders/17', '/projects', '/settings/projects', '/hr/departments/3?fullPage=1', '/hr/departments/3/edit?fullPage=1', '/projects/68/finance/new?fullPage=1', '/projects/new?fullPage=1', '/tasks/new?fullPage=1', '/projects/68/charter?edit=1&fullPage=1']) {
    await page.goto(url)
    await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined)
    await Promise.all(pending)
    await info.attach(`nodes-${url.replace(/\W/g, '_')}.json`, { body: JSON.stringify(await page.evaluate(() => (window as any).__hydrationNodes)), contentType: 'application/json' })
    if (url === '/meetings/2/edit?fullPage=1') {
      await expect(page.locator('#edit-name')).not.toHaveValue('')
      await expect(page.locator('#edit-name')).toHaveAttribute('aria-invalid', 'false')
      await expect(page.locator('#edit-date')).toHaveAttribute('aria-invalid', 'false')
    }
    if (url.includes('tab=board')) {
      const cards = page.locator('[data-testid^="board-card-"]')
      expect(await cards.count()).toBeGreaterThan(0)
      for (const card of await cards.all()) {
        expect((await card.innerText()).trim()).not.toBe('')
        expect((await card.boundingBox())!.height).toBeGreaterThan(50)
      }
    }
  }
  await info.attach('hydration-details.json', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' })
  expect(errors).toEqual([])
})


test('an SSR error retries after hydration and displays the recovered record', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
  const record = await (await page.request.get('/api/v1/hr/departments/3')).json()
  const errors: string[] = []
  page.on('console', msg => { if (/hydration.*mismatch/i.test(msg.text())) errors.push(msg.text()) })
  let recoveredRequests = 0
  // The server still receives the real 404. Only the browser retry recovers.
  await page.route('**/api/v1/hr/departments/999999', async route => {
    recoveredRequests++
    await route.fulfill({ json: record })
  })
  await page.goto('/hr/departments/999999?fullPage=1')
  await expect(page.getByRole('heading', { name: record.name, exact: true })).toBeVisible()
  expect(recoveredRequests).toBe(1)
  expect(errors).toEqual([])
})

test('English tablet routes retain sheets and fit meeting content', async ({ page, context, baseURL }, info) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(5_000)
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
  await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode: 'dark', fontSize: 'large' })), url: baseURL! }])
  await page.setViewportSize({ width: 768, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const url of ['/project-templates/8', '/project-templates/8/apply', '/project-templates/8/edit', '/project-templates/new', '/projects/68/finance/11', '/projects/68/finance/new', '/projects/new', '/meetings/2', '/meetings/calendar']) {
    await page.goto(url)
    await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined)
    if (url !== '/meetings/calendar') await expect(page.locator('.nasq-ui-route-sheet')).toBeVisible()
    await page.evaluate(async () => {
      const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.$nuxt
      await app.$i18n.loadLocaleMessages('en')
      app.$i18n.locale.value = 'en'
    })
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined)
    await page.screenshot({ path: info.outputPath(`tablet-${url.replace(/\W/g, '_')}.png`), fullPage: true })
    if (url !== '/meetings/calendar') {
      await expect(page.locator('.nasq-ui-route-sheet')).toHaveCount(1)
      const frame = (await page.getByTestId('project-route-overlay').boundingBox())!
      const rail = (await page.getByTestId('module-rail').boundingBox())!
      expect(frame.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1)
      expect(frame.width).toBeGreaterThan(500)
    }
    if (url === '/meetings/2') {
      expect(await page.locator('#meeting-summary').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      const sheet = (await page.locator('.nasq-ui-route-sheet').boundingBox())!
      const card = (await page.locator('#meeting-summary').boundingBox())!
      expect(card.x + card.width).toBeLessThanOrEqual(sheet.x + sheet.width + 1)
    }
    if (url === '/meetings/calendar') await expect(page.locator('.calendar-agenda')).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('narrow content keeps milestone metadata and meeting tab labels readable', async ({ page, context, baseURL }, info) => {
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
  await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode: 'dark', fontSize: 'large' })), url: baseURL! }])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 768, height: 1000 })
  await page.goto('/projects/68?tab=milestones')
  await expect(page.getByTestId('milestone-row').first()).toBeVisible()
  const main = page.locator('.milestone-main').first()
  expect((await main.boundingBox())!.width).toBeGreaterThan(220)
  await page.screenshot({ path: info.outputPath('milestones-tablet.png'), fullPage: true })
  await page.goto('/projects/68?tab=summary')
  await expect(page.getByTestId('project-overview')).toBeVisible()
  expect(await page.locator('.project-overview-stats').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1)
  await page.screenshot({ path: info.outputPath('summary-tablet.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect.poll(() => page.locator('.project-overview-stats').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3)
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/meetings/2')
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(7)
  expect(await tabs.evaluateAll(elements => elements.every(el => {
    const label = el.querySelector('[data-slot="label"]') as HTMLElement | null
    return !!label && label.scrollWidth <= label.clientWidth + 1
  }))).toBe(true)
  await tabs.last().focus()
  await page.keyboard.press('Enter')
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.last()).toBeInViewport()
  await page.screenshot({ path: info.outputPath('meeting-mobile-tabs.png'), fullPage: true })
  await page.goto('/meetings/2?tab=versions')
  await expect(page.getByRole('tab', { selected: true })).toBeInViewport({ ratio: 1 })
  const sheet = (await page.locator('.nasq-ui-route-sheet').boundingBox())!
  expect(Math.abs(sheet.x)).toBeLessThanOrEqual(1)
  expect(sheet.width).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath('meeting-mobile-direct-tab.png'), fullPage: true })
})
