import { expect, test, type Page } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

let base = ''
let close: () => Promise<void> = async () => {}
const open = async (page: Page, id: string, globals: string) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`)
  await page.locator('#storybook-root').waitFor()
}
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!
const LOCALES = [['ar', 'rtl'], ['en', 'ltr']] as const

test.describe('Tasmim shell (desktop)', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of LOCALES) {
    for (const fontSize of ['small', 'large'] as const) {
      test(`frame keeps the main rail and 230px context menu with 12px insets and mirrors in ${locale} at ${fontSize} text`, async ({ page }) => {
        await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.locator('html')).toHaveAttribute('dir', dir)
        const header = await box(page, 'shell-header')
        const sidebar = await box(page, 'application-navigation')
        expect(header.height).toBeCloseTo(56, 0)
        expect(header.y).toBeCloseTo(12, 0)
        expect(header.x).toBeCloseTo(12, 0)
        expect(header.x + header.width).toBeCloseTo(1428, 0)
        expect(sidebar.width).toBeCloseTo(230, 0)
        expect(sidebar.y).toBeCloseTo(84, 0)
        expect(sidebar.y + sidebar.height).toBeCloseTo(888, 0)
        if (dir === 'rtl') expect(sidebar.x + sidebar.width).toBeCloseTo(1340, 0)
        else expect(sidebar.x).toBeCloseTo(100, 0)
        await expect(page.getByTestId('module-rail')).toBeVisible()
        await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
      })
    }

    test(`the active module has a tinted round icon circle (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light`)
      const active = page.getByTestId('application-navigation').locator('.webvue-navigation-app[data-active="true"]')
      await expect(active).toHaveCount(1)
      await expect(active.locator('.webvue-context-chip')).toHaveCSS('border-radius', '9999px')
      await expect(page.getByTestId('application-navigation')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    })
  }

  for (const [locale, dir] of LOCALES) {
    test(`a collapsed sidebar is a 64px icon bar with hidden labels (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--collapsed', `locale:${locale};appearance:light`)
      const sidebar = page.getByTestId('application-navigation')
      await expect(sidebar).toHaveAttribute('data-expanded', 'false')
      expect((await box(page, 'application-navigation')).width).toBeCloseTo(64, 0)
      await expect(page.getByTestId('context-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('navigation-app-projects')).toHaveAccessibleName(locale === 'ar' ? 'المشاريع' : 'Projects')
      const main = (await box(page, 'shell-main'))
      // Inline-start: 12 + 76 + 12 + 64 + 12; inline-end: 12.
      if (dir === 'rtl') {
        expect(main.x + main.width).toBeCloseTo(1440 - 176, 0)
        expect(main.x).toBeCloseTo(12, 0)
      } else {
        expect(main.x).toBeCloseTo(176, 0)
        expect(main.x + main.width).toBeCloseTo(1440 - 12, 0)
      }
    })
  }

  test('only one application submenu is visible and a trigger keeps the current route', async ({ page }) => {
    await open(page, 'shell-shellnavigation--expanded', 'locale:ar;appearance:light')
    const current = page.url()
    await page.getByTestId('navigation-app-projects').click()
    await expect(page.getByTestId('navigation-submenu-projects')).toBeVisible()
    await expect(page.getByTestId('navigation-submenu-meetings')).toHaveCount(0)
    await page.getByTestId('navigation-app-meetings').click()
    await expect(page.getByTestId('navigation-submenu-meetings')).toBeVisible()
    await expect(page.getByTestId('navigation-submenu-projects')).toHaveCount(0)
    expect(page.url()).toBe(current)
  })

  test('[ toggles the sidebar by physical key, also on an Arabic layout, but not while typing or with a modifier', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    const sidebar = page.getByTestId('application-navigation')
    await expect(page.getByTestId('context-sidebar-toggle')).toBeEnabled()
    await expect(sidebar).toHaveAttribute('data-expanded', 'true')
    await page.keyboard.press('BracketLeft')
    await expect(sidebar).toHaveAttribute('data-expanded', 'false')
    // Arabic layout: the same physical key types «ج».
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ج', code: 'BracketLeft', bubbles: true })))
    await expect(sidebar).toHaveAttribute('data-expanded', 'true')
    await page.keyboard.press('Control+BracketLeft')
    await expect(sidebar).toHaveAttribute('data-expanded', 'true')
    await page.evaluate(() => {
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', bubbles: true }))
      input.remove()
    })
    await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  })

  for (const [locale, module, current] of [['ar', 'المشاريع', 'مهامي'], ['en', 'Projects', 'My tasks']] as const) {
    test(`breadcrumb names the module and the current section (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light`)
      const trail = page.getByTestId('shell-breadcrumb')
      await expect(trail).toHaveAccessibleName(locale === 'ar' ? 'مسار الصفحة' : 'Breadcrumb')
      await expect(trail.getByRole('link', { name: module, exact: true })).toHaveAttribute('href', '/projects')
      await expect(trail.locator('[aria-current="page"]')).toHaveText(current)
      await expect(page.getByTestId('shell-header').locator('h1')).toHaveCount(0)
    })
  }

  test('header controls wait for nothing in Storybook and keep the 32px control height', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    const search = page.getByRole('button', { name: 'بحث', exact: true })
    await expect(search).toBeEnabled()
    expect((await search.boundingBox())!.height).toBeCloseTo(32, 0)
  })
})

test.describe('Tasmim shell (390px)', () => {
  requireStorybook()
  test.use({ viewport: { width: 390, height: 844 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of LOCALES) {
    for (const fontSize of ['small', 'large'] as const) {
      test(`drawer opens from the inline-start side at 390px (${locale}, ${fontSize})`, async ({ page }) => {
        await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.getByTestId('module-rail')).toBeHidden()
        await expect(page.getByTestId('application-navigation')).toBeHidden()
        const header = await box(page, 'shell-header')
        expect(header.x).toBeCloseTo(12, 0)
        expect(header.width).toBeCloseTo(366, 0)
        expect(header.height).toBeCloseTo(56, 0)
        for (const control of await page.getByTestId('shell-header').getByRole('button').all()) {
          const area = (await control.boundingBox())!
          expect(area.height).toBeGreaterThanOrEqual(44)
          expect(area.x + area.width).toBeLessThanOrEqual(390)
        }
        const trigger = page.getByTestId('mobile-navigation-trigger')
        await expect(trigger).toBeEnabled()
        await trigger.click()
        const drawer = page.locator('#mobile-navigation')
        await expect(drawer).toBeVisible()
        const area = (await drawer.boundingBox())!
        expect(area.width).toBeCloseTo(320, 0)
        if (dir === 'rtl') expect(area.x + area.width).toBeCloseTo(390, 0)
        else expect(area.x).toBeCloseTo(0, 0)
        await expect(drawer.getByTestId('context-link-tasks')).toHaveAttribute('aria-current', 'true')
        for (const link of await drawer.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    }
  }
})

test.describe('Tasmim command palette', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'بحث', exact: true })

  for (const chord of ['Meta+k', 'Control+k'] as const) {
    test(`${chord} opens the palette with its input focused and toggles it closed`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
      await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
      await page.keyboard.press(chord)
      await expect(dialog(page)).toBeVisible()
      await expect(dialog(page).getByRole('textbox', { name: 'بحث', exact: true })).toBeFocused()
      await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
      await page.keyboard.press(chord)
      await expect(dialog(page)).toBeHidden()
    })
  }

  test('typing filters Go to; Enter opens the highlighted page', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    await page.getByTestId('global-search-trigger').click()
    await page.keyboard.type('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await expect(dialog(page).getByRole('option', { name: 'مهامي', exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByTestId('context-link-projects')).toHaveAttribute('aria-current', 'true')
  })

  test('Esc closes and returns focus to the trigger, or to the element ⌘K was pressed on', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    const trigger = page.getByTestId('global-search-trigger')
    await trigger.click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(trigger).toBeFocused()
    const link = page.getByTestId('context-link-tasks')
    await link.focus()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(link).toBeFocused()
  })

  test('closing keeps the typed term and the rows until the exit animation ends', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('textbox').fill('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    // Sample every frame while the dialog is still in the DOM after Esc: no empty state, no emptied input, no vanished rows.
    const frames = await page.evaluate(() => new Promise<{ seen: number, empty: number, cleared: number, rowless: number }>(resolve => {
      const out = { seen: 0, empty: 0, cleared: 0, rowless: 0 }
      const started = performance.now()
      const sample = () => {
        const palette = document.querySelector('[data-testid="command-palette"]')
        if (palette) {
          out.seen++
          if (palette.textContent?.includes('لا نتائج')) out.empty++
          if (!(palette.querySelector('input') as HTMLInputElement | null)?.value) out.cleared++
          if (!palette.querySelector('[role="option"]')) out.rowless++
        }
        if (performance.now() - started > 700) resolve(out)
        else requestAnimationFrame(sample)
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      requestAnimationFrame(sample)
    }))
    expect(frames.seen).toBeGreaterThan(0)
    expect(frames).toMatchObject({ empty: 0, cleared: 0, rowless: 0 })
    await expect(dialog(page)).toBeHidden()
    // Reopening starts clean.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page).getByRole('textbox')).toHaveValue('')
  })

  test('? opens the shortcut help inside the same dialog; Backspace and the back button return', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await page.keyboard.press('Shift+Slash')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toHaveAttribute('data-view', 'shortcuts')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(palette.getByRole('option', { name: /فتح لوحة الأوامر/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /الانتقال إلى المشاريع/ })).toContainText('P')
    await page.keyboard.press('Backspace')
    await expect(palette).toHaveAttribute('data-view', 'main')
    await palette.getByRole('option', { name: 'اختصارات لوحة المفاتيح', exact: true }).click()
    await expect(palette).toHaveAttribute('data-view', 'shortcuts')
    await page.getByTestId('palette-back').click()
    await expect(palette).toHaveAttribute('data-view', 'main')
  })

  test('Actions hide commands the user cannot run', async ({ page }) => {
    await open(page, 'shell-globalsearch--palette-main', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'مشروع جديد', exact: true })).toBeVisible()
    await open(page, 'shell-globalsearch--palette-read-only', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'مشروع جديد', exact: true })).toHaveCount(0)
  })

  test('search shows provider rows, and a retry row when a provider fails', async ({ page }) => {
    await open(page, 'shell-globalsearch--palette-search', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'مشروع ألفا', exact: true })).toBeVisible()
    await open(page, 'shell-globalsearch--palette-error', 'locale:ar;appearance:light')
    await expect(page.getByRole('option', { name: 'تعذّر البحث. اختر للمحاولة مجددًا.', exact: true })).toBeVisible()
  })

  for (const [locale, dir] of LOCALES) {
    test(`the palette follows the page direction (${locale})`, async ({ page }) => {
      await open(page, 'shell-globalsearch--palette-main', `locale:${locale};appearance:light`)
      const palette = page.getByTestId('command-palette')
      await expect(palette).toHaveAttribute('dir', dir)
      const option = page.getByRole('option').first()
      await expect(option).toBeVisible()
      const row = (await option.boundingBox())!
      const icon = (await option.locator('[data-slot="itemLeadingIcon"]').boundingBox())!
      if (dir === 'rtl') expect(icon.x + icon.width).toBeGreaterThan(row.x + row.width - 40)
      else expect(icon.x).toBeLessThan(row.x + 40)
    })
  }
})

test.describe('Tasmim row navigation', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('J and K move between marked rows by label or position; Enter opens the row', async ({ page }) => {
    await open(page, 'shell-rownavigation--demo', 'locale:ar;appearance:light')
    const rows = page.locator('[data-shortcut-row]')
    await page.keyboard.press('j')
    await expect(rows.nth(0)).toBeFocused()
    await page.keyboard.press('j')
    await expect(rows.nth(1)).toBeFocused()
    await page.keyboard.press('k')
    await expect(rows.nth(0)).toBeFocused()
    await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ت', code: 'KeyJ', bubbles: true, cancelable: true })))
    await expect(rows.nth(1)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#project-2')
  })
})
