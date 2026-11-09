import { expect, test } from '@playwright/test'
import { expectAlignedGuide } from './helpers/navigationGeometry'

test.setTimeout(90_000)
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })).status()).toBe(200)
  await page.goto('/meetings')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
})

test('the application name is static and each branch folds on its own button without navigation', async ({ page }) => {
  const navigation = page.getByTestId('application-navigation')
  await expect(navigation.getByTestId('navigation-app-block')).toHaveText('الاجتماعات')
  await expect(navigation.locator('h2 button')).toHaveCount(0)
  const meetings = navigation.getByTestId('context-link-meetings')
  await expect(meetings).toHaveAttribute('aria-expanded', 'true')
  const originalUrl = page.url()
  await meetings.click()
  await expect(meetings).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('quick-view-done')).toHaveCount(0)
  await expect(navigation.getByTestId('context-link-meeting-followup')).toBeVisible()
  await expect(navigation.getByTestId('quick-action-new-meeting')).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await meetings.click()
  await expect(navigation.getByTestId('quick-view-done')).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await navigation.getByTestId('quick-view-done').click()
  await expect(page).toHaveURL(/state=done/)
})

test('the meetings branch is keyboard operable and retains its unfiltered destination', async ({ page }) => {
  const navigation = page.getByTestId('application-navigation')
  const meetings = navigation.getByTestId('context-link-meetings')
  await meetings.press('Enter')
  await expect(meetings).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('submenu-meetings')).toHaveCount(0)
  await meetings.press('Space')
  await expect(meetings).toHaveAttribute('aria-expanded', 'true')
  await navigation.getByTestId('context-link-meetings-all').click()
  await expect(page).toHaveURL(/\/meetings$/)
})

test('parent and child levels have distinct labels and visual hierarchy in RTL', async ({ page }) => {
  await page.goto('/meetings')
  const menu = page.getByTestId('application-navigation')
  const parent = menu.getByTestId('context-link-meetings')
  await expect(parent).toHaveAccessibleName('قائمة الاجتماعات')
  const children = menu.getByTestId('submenu-meetings')
  await expect(children).toBeVisible()
  await expectAlignedGuide(parent)
  expect(await parent.getAttribute('data-active')).toBeNull()
  const all = children.getByRole('link', { name: 'عرض الكل', exact: true })
  await expect(all).toHaveAttribute('data-active', 'true')
  await expect(all).toHaveCSS('font-weight', '600')
})

test('English hierarchy mirrors the guide', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'liwan-locale', value: 'en', url: baseURL! }])
  await page.goto('/meetings')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  const menu = page.getByTestId('application-navigation')
  await expect(menu.getByTestId('context-link-meetings')).toHaveAccessibleName('Meetings list')
  await expectAlignedGuide(menu.getByTestId('context-link-meetings'))
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

// Under 768px the branches live in the drawer; from 768px to 1099px the sidebar is an 84px icon column that shows no
// branches; from 1100px the full sidebar draws the guide.
for (const entry of responsiveCases) {
  test.describe(`submenu guide at ${entry.width}px`, () => {
    test.use({ viewport: { width: entry.width, height: 900 }, isMobile: entry.width < 768, hasTouch: entry.width < 768 })
    for (const locale of ['ar', 'en']) {
      test(`aligns and fits in ${locale}, ${entry.fontSize}, ${entry.mode}`, async ({ page, baseURL }) => {
        expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: entry.mode, font_size: entry.fontSize } })).status()).toBe(200)
        try {
          await page.context().addCookies([{ name: 'liwan-locale', value: locale, url: baseURL! }])
          await page.goto('/meetings?state=done')
          await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
          await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
          await expect(page.locator('html')).toHaveAttribute('data-font-size', entry.fontSize)
          await expect(page.locator('html')).toHaveCSS('color-scheme', entry.mode)
          let menu = page.getByTestId('application-navigation')
          let prefix = ''
          if (entry.width < 768) {
            await page.getByTestId('mobile-navigation-trigger').click()
            menu = page.locator('#mobile-navigation')
            prefix = 'mobile-'
          }
          const parent = menu.getByTestId(`${prefix}context-link-meetings`)
          await expect(parent).toBeVisible()
          await expect(parent).toHaveAttribute('aria-expanded', 'true')
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
          if (entry.width >= 768 && entry.width < 1100) {
            expect((await menu.boundingBox())!.width).toBe(84)
            await expect(menu.getByTestId('submenu-meetings')).toBeHidden()
            return
          }
          const child = menu.locator('.liwan-side-branch .liwan-side-row[data-active="true"]')
          await expect(child).toBeVisible()
          await expectAlignedGuide(parent)
          expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
          expect(await menu.locator('.liwan-side-branch [data-slot="label"]').evaluateAll(labels => labels.every(label => {
            const text = label.getBoundingClientRect()
            const row = label.closest('.liwan-side-row')!.getBoundingClientRect()
            return text.left >= row.left - 1 && text.right <= row.right + 1
          }))).toBe(true)
        } finally {
          await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
        }
      })
    }
  })
}
