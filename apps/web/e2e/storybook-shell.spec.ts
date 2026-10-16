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
      test(`frame is 48/64/232 and mirrors in ${locale} at ${fontSize} text`, async ({ page }) => {
        await open(page, 'shell-shellframe--default', `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.locator('html')).toHaveAttribute('dir', dir)
        const header = await box(page, 'shell-header')
        const rail = await box(page, 'module-rail')
        const sidebar = await box(page, 'context-sidebar')
        expect(header.height).toBeCloseTo(48, 0)
        expect(rail.width).toBeCloseTo(64, 0)
        expect(rail.y).toBeCloseTo(0, 0)
        expect(rail.height).toBeCloseTo(900, 0)
        expect(sidebar.width).toBeCloseTo(232, 0)
        expect(sidebar.y).toBeCloseTo(48, 0)
        if (dir === 'rtl') {
          expect(rail.x + rail.width).toBeCloseTo(1440, 0)
          expect(header.x).toBeCloseTo(0, 0)
          expect(header.x + header.width).toBeCloseTo(rail.x, 0)
          expect(sidebar.x + sidebar.width).toBeCloseTo(rail.x, 0)
        } else {
          expect(rail.x).toBeCloseTo(0, 0)
          expect(header.x).toBeCloseTo(64, 0)
          expect(header.x + header.width).toBeCloseTo(1440, 0)
          expect(sidebar.x).toBeCloseTo(64, 0)
        }
        await expect(page.getByTestId('module-rail-toggle')).toHaveCount(0)
      })
    }

    test(`the active module carries a lime bar on the rail's inline-start edge (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--default', `locale:${locale};appearance:dark`)
      const rail = await box(page, 'module-rail')
      const active = page.getByTestId('module-rail').locator('[aria-current="page"]')
      await expect(active).toHaveCount(1)
      const bar = active.locator('[data-slot="indicator"]')
      const barBox = (await bar.boundingBox())!
      expect(barBox.width).toBeCloseTo(3, 0)
      if (dir === 'rtl') expect(barBox.x + barBox.width).toBeCloseTo(rail.x + rail.width, 0)
      else expect(barBox.x).toBeCloseTo(rail.x, 0)
      await expect(bar).toHaveCSS('background-color', 'rgb(200, 240, 49)')
      await expect(page.getByTestId('module-rail').locator('[data-slot="indicator"]')).toHaveCount(1)
    })
  }

  for (const [appearance, midnight] of [['light', 'rgb(19, 35, 74)'], ['dark', 'rgb(13, 26, 56)']] as const) {
    test(`rail stays midnight under a bright tenant primary (${appearance})`, async ({ page }) => {
      await open(page, 'shell-shellframe--bright-tenant', `locale:ar;appearance:${appearance}`)
      // Precondition: the tenant colour really reached the document.
      const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase())
      expect(primary).not.toBe('')
      expect(primary).not.toBe('#13234a')
      const rail = page.getByTestId('module-rail')
      await expect(rail).toHaveCSS('background-color', midnight)
      expect(await rail.evaluate(element => getComputedStyle(element).backgroundImage)).not.toContain('255, 0, 255')
      await expect(rail.locator('[data-slot="indicator"]')).toHaveCSS('background-color', 'rgb(200, 240, 49)')
    })
  }
  for (const [locale, dir] of LOCALES) {
    test(`a collapsed sidebar is 48px icons with hidden labels (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--collapsed', `locale:${locale};appearance:light`)
      const sidebar = page.getByTestId('context-sidebar')
      await expect(sidebar).toHaveAttribute('data-expanded', 'false')
      expect((await box(page, 'context-sidebar')).width).toBeCloseTo(48, 0)
      await expect(page.getByTestId('context-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('context-link-tasks')).toHaveAccessibleName(locale === 'ar' ? 'مهامي' : 'My tasks')
      const main = (await box(page, 'shell-main'))
      if (dir === 'rtl') expect(main.x + main.width).toBeCloseTo(1440 - 64 - 48, 0)
      else expect(main.x).toBeCloseTo(64 + 48, 0)
    })
  }

  test('counters sit beside the link without changing its name', async ({ page }) => {
    await open(page, 'shell-contextsidebar--projects', 'locale:ar;appearance:light')
    const link = page.getByTestId('context-link-tasks')
    await expect(link).toHaveAccessibleName('مهامي')
    const counter = page.locator(`[id="${await link.getAttribute('aria-describedby')}"]`)
    await expect(counter).toHaveText('7')
    await expect(page.locator('.webvue-context-section-title')).toHaveCount(0)
  })

  test('section headings render when links declare them', async ({ page }) => {
    await open(page, 'shell-contextsidebar--with-sections', 'locale:ar;appearance:light')
    await expect(page.locator('.webvue-context-section-title')).toHaveText(['إدارة النظام', 'هوية الجهة'])
  })

  test('[ toggles the sidebar by physical key, also on an Arabic layout, but not while typing or with a modifier', async ({ page }) => {
    await open(page, 'shell-shellframe--default', 'locale:ar;appearance:light')
    const sidebar = page.getByTestId('context-sidebar')
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
        await expect(page.getByTestId('context-sidebar')).toBeHidden()
        const header = await box(page, 'shell-header')
        expect(header.x).toBeCloseTo(0, 0)
        expect(header.width).toBeCloseTo(390, 0)
        expect(header.height).toBeCloseTo(48, 0)
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
        await expect(drawer.getByTestId('mobile-context-link-tasks')).toHaveAttribute('aria-current', 'page')
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
    await expect(page.getByTestId('context-link-projects')).toHaveAttribute('aria-current', 'page')
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
