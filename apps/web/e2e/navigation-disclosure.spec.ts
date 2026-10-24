import { expect, test } from '@playwright/test'
import { expectAlignedGuide } from './helpers/navigationGeometry'

test.setTimeout(90_000)
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })).status()).toBe(200)
  await page.goto('/tasks?view=board')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
})

test('the context title is static and Tasks folds only its own presets without navigation', async ({ page }) => {
  const navigation = page.getByTestId('application-navigation')
  await expect(navigation.locator('h2')).toHaveText('المشاريع')
  await expect(navigation.locator('h2 button')).toHaveCount(0)
  const tasks = navigation.getByTestId('context-link-tasks')
  await expect(tasks).toHaveAttribute('aria-expanded', 'true')
  const originalUrl = page.url()
  await tasks.click()
  await expect(tasks).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('projects-quick-view-today')).not.toBeVisible()
  await expect(navigation.getByTestId('context-link-project-dashboard')).toBeVisible()
  await expect(navigation.getByTestId('context-link-projects')).toBeVisible()
  await expect(navigation.getByTestId('projects-quick-action-new-project')).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await tasks.click()
  await expect(navigation.getByTestId('projects-quick-view-today')).toBeVisible()
  await navigation.getByTestId('context-link-projects').click()
  await expect(navigation.getByTestId('context-link-projects')).toHaveAttribute('aria-expanded', 'true')
  await expect(tasks).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('projects-quick-view-today')).not.toBeVisible()
  await expect(navigation.getByTestId('projects-quick-view-mine')).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await tasks.click()
  await navigation.getByTestId('projects-quick-view-today').click()
  await expect(page).toHaveURL(/deadline=today/)
  await expect(page).toHaveURL(/view=board/)
})

test('the Tasks submenu is keyboard operable and retains its unfiltered destination', async ({ page }) => {
  const navigation = page.getByTestId('application-navigation')
  const tasks = navigation.getByTestId('context-link-tasks')
  const controlledId = await tasks.getAttribute('aria-controls')
  expect(controlledId).toBeTruthy()
  await tasks.press('Enter')
  await expect(tasks).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('projects-submenu-tasks')).not.toBeVisible()
  await expect(page.locator(`[id="${controlledId}"]`)).toHaveCount(1)
  await tasks.press('Space')
  await expect(tasks).toHaveAttribute('aria-expanded', 'true')
  await navigation.getByTestId('projects-context-link-tasks-all').click()
  await expect(page).toHaveURL(/\/tasks\?view=board$/)
})

test('parent and child levels have distinct labels and visual hierarchy in RTL', async ({ page }) => {
  await page.goto('/projects')
  const menu = page.getByTestId('application-navigation')
  const parent = menu.getByTestId('context-link-projects')
  await expect(parent).toHaveAccessibleName('قائمة المشاريع')
  const children = menu.getByTestId('projects-submenu-projects')
  await expect(children).toBeVisible()
  await expectAlignedGuide(parent)
  await expect(parent).toHaveCSS('font-weight', '600')
  expect(await parent.getAttribute('data-active')).toBeNull()
  const all = children.getByRole('link', { name: 'عرض الكل', exact: true })
  await expect(all).toHaveAttribute('data-active', 'true')
  await expect(all.locator('.webvue-quick-chip')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('English hierarchy mirrors the guide and reduced motion reaches collapsed popups', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'webvue-locale', value: 'en', url: baseURL! }])
  await page.goto('/projects')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  const menu = page.getByTestId('application-navigation')
  await expect(menu.getByTestId('context-link-projects')).toHaveAccessibleName('Projects list')
  const children = menu.getByTestId('projects-submenu-projects')
  await expectAlignedGuide(menu.getByTestId('context-link-projects'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('context-sidebar-toggle').click()
  await page.getByTestId('navigation-app-projects').click()
  const popup = page.locator('.webvue-navigation-popup')
  await popup.getByTestId('context-link-projects').click()
  await expect(popup.getByTestId('projects-submenu-projects')).toBeVisible()
  await expectAlignedGuide(popup.getByTestId('context-link-projects'))
  await expect(popup.locator('[data-slot="content"]').last()).toHaveCSS('animation-name', 'none')
})

const responsiveCases = [
  { width: 360, fontSize: 'large', mode: 'dark' },
  { width: 390, fontSize: 'small', mode: 'light' },
  { width: 767, fontSize: 'medium', mode: 'dark' },
  { width: 768, fontSize: 'small', mode: 'light' },
  { width: 1024, fontSize: 'large', mode: 'dark' },
  { width: 1100, fontSize: 'medium', mode: 'light' },
  { width: 1440, fontSize: 'large', mode: 'dark' },
] as const

for (const entry of responsiveCases) {
  test.describe(`submenu guide at ${entry.width}px`, () => {
    test.use({ viewport: { width: entry.width, height: 900 }, isMobile: entry.width < 768, hasTouch: entry.width < 768 })
    for (const locale of ['ar', 'en']) {
      test(`aligns and fits in ${locale}, ${entry.fontSize}, ${entry.mode}`, async ({ page, baseURL }) => {
        expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: entry.mode, font_size: entry.fontSize } })).status()).toBe(200)
        try {
          await page.context().addCookies([{ name: 'webvue-locale', value: locale, url: baseURL! }])
          await page.goto('/projects?status=at_risk')
          await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
          await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
          await expect(page.locator('html')).toHaveAttribute('data-font-size', entry.fontSize)
          await expect(page.locator('html')).toHaveCSS('color-scheme', entry.mode)
          let menu = page.getByTestId('application-navigation')
          if (entry.width < 768) {
            await page.getByTestId('mobile-navigation-trigger').click()
            menu = page.locator('#mobile-navigation')
          } else if (await menu.getAttribute('data-expanded') === 'false') {
            await page.getByTestId('context-sidebar-toggle').click()
          }
          const parent = menu.getByTestId('context-link-projects')
          await expect(parent).toBeVisible()
          await expect(parent).toHaveAttribute('aria-expanded', 'true')
          const child = menu.locator('.webvue-navigation-submenu .webvue-quick-link[data-active="true"]')
          await expect(child).toBeVisible()
          // Finish width/open transitions before comparing exact visual geometry.
          await menu.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))) })
          await expectAlignedGuide(parent)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
          expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
          expect(await menu.locator('.webvue-navigation-submenu [data-slot="label"]').evaluateAll(labels => labels.every(label => {
            const text = label.getBoundingClientRect()
            const row = label.closest('.webvue-quick-link')!.getBoundingClientRect()
            return text.left >= row.left - 1 && text.right <= row.right + 1
          }))).toBe(true)
        } finally {
          await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
        }
      })
    }
  })
}
