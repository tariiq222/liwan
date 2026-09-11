import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isWorkspaceOverlayRoute } from '../app/utils/workspacePresentation'
import { firstAllowedPath } from '../app/utils/accessPolicy'

const fixturePath = process.env.E2E_ALL_UI_FIXTURES ?? '/Users/tariq/code/nasq-nuxt-migration-artifacts/all-ui/fixtures.json'
const ids = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, any>
const pageRoot = fileURLToPath(new URL('../app/pages/', import.meta.url))
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? entry.name === '__tests__' ? [] : files(path.join(dir, entry.name)) : entry.name.endsWith('.vue') ? [path.relative(pageRoot, path.join(dir, entry.name)).replaceAll('\\', '/')] : [])
}
const routeFiles = files(pageRoot).sort()
function concrete(source: string, resource = 'types'): string {
  let result = '/' + source.replace(/\.vue$/, '').replace(/(^|\/)index$/, '')
  if (!result) result = '/'
  const id = result.startsWith('/projects/') ? ids.projectId
    : result.startsWith('/project-templates/') ? ids.templateId
      : result.startsWith('/tasks/') ? ids.taskId
        : result.startsWith('/meetings/series/') ? ids.seriesId
          : result.startsWith('/meetings/') ? ids.meetingId
            : result.startsWith('/chat/') ? ids.conversationId
              : result.startsWith('/notification-digests/') ? ids.digestNotificationId : undefined
  result = result.replace('[id]', String(id))
  const replacements: Record<string, unknown> = { taskId: ids.taskId, milestoneId: ids.milestoneId, entryId: ids.entryId, registerId: ids.registerId, stakeholderId: ids.stakeholderId, departmentId: ids.departmentId, documentId: ids.documentId, employeeId: ids.employeeId, userId: ids.userId, roleId: ids.roleId, eventId: ids.eventId, resolutionId: ids.resolutionId, resource, referenceId: ids.referenceIds[resource] }
  result = result.replace(/\[([^\]]+)\]/g, (_, key: string) => String(replacements[key]))
  if (/undefined|\[/.test(result)) throw new Error(`Unresolved route ${source}: ${result}`)
  return result
}
const routes = routeFiles.filter(source => source !== 'login.vue').flatMap(source => {
  const values = source.includes('[resource]') ? ['types', 'owning-units'] : ['types']
  return values.map(resource => ({ source, url: concrete(source, resource) }))
})
for (const tab of ['board', 'table']) routes.push({ source: 'tasks.vue', url: `/tasks?tab=${tab}` })
for (const tab of ['tasks', 'summary', 'milestones', 'board']) routes.push({ source: 'projects/[id].vue', url: `/projects/${ids.projectId}?tab=${tab}` })
for (const tab of ['summary', 'agenda', 'minutes', 'resolutions', 'attachments', 'history', 'versions']) routes.push({ source: 'meetings/[id].vue', url: `/meetings/${ids.meetingId}?tab=${tab}` })
routes.push({ source: 'projects/[id]/charter.vue', url: `/projects/${ids.projectId}/charter?edit=1` })
for (const row of [...routes]) {
  const url = new URL(row.url, 'http://nasq.local')
  if (isWorkspaceOverlayRoute({ path: url.pathname, query: Object.fromEntries(url.searchParams) })) {
    url.searchParams.set('fullPage', '1')
    routes.push({ source: row.source, url: url.pathname + url.search })
  }
}

test('English messages load inside a form without navigating through its draft guard', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
  await page.goto('/projects/new?fullPage=1')
  await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
  await page.evaluate(async () => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__.$nuxt
    await app.$i18n.loadLocaleMessages('en')
    app.$i18n.locale.value = 'en'
  })
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page).toHaveURL(/\/projects\/new\?fullPage=1$/)
})

for (const [mode, fontSize, width, locale] of [['light', 'small', 1440, 'ar'], ['dark', 'large', 768, 'en'], ['cream', 'medium', 390, 'ar']] as const) {
  test(`every customer route: ${mode}/${fontSize}/${width}/${locale}`, async ({ page, context, baseURL }, info) => {
    test.setTimeout(1_200_000)
    expect(baseURL).toBe('http://127.0.0.1:3469')
    expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
    const me = await (await page.request.get('/api/v1/me')).json()
    await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize })), url: baseURL! }])
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    page.setDefaultNavigationTimeout(15_000)
    page.setDefaultTimeout(5_000)
    // This inventory intentionally leaves fixture forms without saving. Keep
    // the product's unload guard, but explicitly discard during traversal.
    page.on('dialog', async dialog => {
      if (dialog.type() === 'beforeunload') await dialog.accept()
      else await dialog.dismiss()
    })
    const coverage: { source: string; url: string; actual: string; errors: string[] }[] = []
    let errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (/Failed to resolve component|Hydration.*mismatch/i.test(message.text())) errors.push(message.text()) })
    page.on('response', response => { if (response.url().includes('/api/v1/') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
    for (const [index, row] of routes.entries()) {
      errors = []
      if (index % 10 === 0) console.log(`[route-audit] ${mode} ${index + 1}/${routes.length} ${row.url}`)
      const errorStart = info.errors.length
      try {
        await page.goto(row.url)
        await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
        await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined)
        // The shell can mount before its async route sheet. Switch locale
        // only once that foreground has mounted, as a user would do.
        const initialUrl = new URL(page.url())
        const initialSheet = isWorkspaceOverlayRoute({ path: initialUrl.pathname, query: Object.fromEntries(initialUrl.searchParams) }) && initialUrl.searchParams.get('fullPage') !== '1'
        await expect(page.locator(initialSheet ? '.nasq-ui-route-sheet' : 'main').first()).toBeVisible()
        if (locale === 'en') {
          await page.evaluate(async () => {
            const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.$nuxt
            if (!app?.$i18n) throw new Error('i18n runtime missing')
            // Exercise the English messages without invoking a route navigation
            // through an open form's unsaved-change guard.
            await app.$i18n.loadLocaleMessages('en')
            app.$i18n.locale.value = 'en'
          })
        }
        await page.evaluate(() => document.fonts.ready)
        await expect.soft(page.locator('html'), row.url).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expect.soft(page.locator('html'), row.url).toHaveAttribute('data-font-size', fontSize)
        const expectedPath = row.source === 'index.vue' ? firstAllowedPath(me) : row.source === 'reports.vue' ? '/projects/dashboard' : row.source.startsWith('hr/') && row.source.endsWith('/access.vue') ? `/settings/users/${ids.userId}` : new URL(row.url, baseURL).pathname
        expect.soft(new URL(page.url()).pathname, row.url).toBe(expectedPath)
        const actual = new URL(page.url())
        if (new URL(row.url, baseURL).searchParams.get('fullPage') === '1') expect.soft(actual.searchParams.get('fullPage'), row.url).toBe('1')
        const sheetExpected = isWorkspaceOverlayRoute({ path: actual.pathname, query: Object.fromEntries(actual.searchParams) }) && actual.searchParams.get('fullPage') !== '1'
        await expect.soft(page.locator('.nasq-ui-route-sheet'), row.url).toHaveCount(sheetExpected ? 1 : 0)
        const foreground = sheetExpected ? page.locator('.nasq-ui-route-sheet') : page.locator('main').first()
        await expect.soft(foreground, row.url).toBeVisible()
        expect.soft((await foreground.innerText()).trim().length, row.url).toBeGreaterThan(0)
        if (sheetExpected) expect.soft((await foreground.boundingBox())!.width, row.url).toBeLessThanOrEqual(width)
        expect.soft(await page.locator('html').evaluate(el => el.classList.contains('dark')), row.url).toBe(mode === 'dark')
        expect.soft(await page.locator('html').evaluate(el => el.classList.contains('cream')), row.url).toBe(mode === 'cream')
        if (row.url.includes('tab=board')) await expect.soft(page.getByTestId('board-column').first()).toBeVisible()
        if (row.source.endsWith('/print.vue')) await expect.soft(page.getByTestId('meeting-minutes-document')).toBeVisible()
        await expect.soft(page.locator('body'), row.url).not.toContainText(/500\s*Internal Server Error|Page not found|\[object Object\]|\[object Promise\]/)
        await expect.soft(page.locator('.nasq-panel-header,.nasq-panel,.nasq-form-section-heading,.nasq-metrics'), row.url).toHaveCount(0)
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Document overflow: ${row.url}`).toBe(true)
        if (row.source === 'reports.vue') await expect.soft(page).toHaveURL(/\/projects\/dashboard/)
        if (row.source.endsWith('/access.vue') && row.source.startsWith('hr/')) await expect.soft(page).toHaveURL(new RegExp(`/settings/users/${ids.userId}`))
        const shot = `${String(index).padStart(3, '0')}-${row.url.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        await page.screenshot({ path: info.outputPath(`${shot}.png`), fullPage: true })
        const disclosures = foreground.locator('details:not([open]) > summary')
        if (await disclosures.count()) {
          for (const summary of await disclosures.all()) if (await summary.isVisible()) await summary.click()
          await page.screenshot({ path: info.outputPath(`${shot}-expanded.png`), fullPage: true })
          await expect.soft(foreground.locator('.nasq-panel,.nasq-panel-header')).toHaveCount(0)
        }
      } catch (error) { errors.push(String(error)) }
      errors.push(...info.errors.slice(errorStart).map(error => error.message ?? String(error)))
      coverage.push({ source: row.source, url: row.url, actual: page.url(), errors: [...errors] })
      expect.soft(errors, row.url).toEqual([])
    }
    await info.attach('route-coverage.json', { body: JSON.stringify(coverage, null, 2), contentType: 'application/json' })
    expect(new Set(coverage.map(row => row.source)).size).toBe(routeFiles.length - 1)
  })
}

test('unauthenticated login uses shared controls in all three appearance modes', async ({ page, context, baseURL }, info) => {
  expect(baseURL).toBe('http://127.0.0.1:3469')
  for (const [mode, width] of [['light', 1440], ['dark', 768], ['cream', 390]] as const) {
    await context.clearCookies()
    await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: baseURL! }])
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/login')
    await expect(page.getByLabel('اسم المستخدم')).toBeVisible()
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`login-${mode}.png`), fullPage: true })
  }
})


test('shared appearance radio cards persist modes and font sizes after reload', async ({ page, baseURL }, info) => {
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
  await page.goto('/settings/appearance')
  for (const mode of ['dark', 'cream', 'light']) {
    await page.getByTestId(`appearance-mode-${mode}`).click()
    await expect.poll(() => page.locator('html').evaluate((el, value) => value === 'light' ? !el.classList.contains('dark') && !el.classList.contains('cream') : el.classList.contains(value), mode)).toBe(true)
  }
  for (const font of ['large', 'medium', 'small']) {
    await page.getByTestId(`appearance-font-${font}`).click()
    await expect(page.locator('html')).toHaveAttribute('data-font-size', font)
  }
  await page.getByTestId('appearance-mode-cream').click()
  await page.getByTestId('appearance-font-large').click()
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/cream/)
  await expect(page.locator('html')).toHaveAttribute('data-font-size', 'large')
  await page.screenshot({ path: info.outputPath('appearance-persisted.png'), fullPage: true })
})
