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

const FRAME = 'shell-shellframe--application'

test.describe('Tasmim shell (desktop)', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of LOCALES) {
    for (const fontSize of ['small', 'large'] as const) {
      test(`frame keeps a fixed 264px sidebar and a 68px flat top bar and mirrors in ${locale} at ${fontSize} text`, async ({ page }) => {
        await open(page, FRAME, `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.locator('html')).toHaveAttribute('dir', dir)
        const header = await box(page, 'shell-header')
        const sidebar = await box(page, 'application-navigation')
        const main = await box(page, 'shell-main')
        expect(header.height).toBeCloseTo(68, 0)
        expect(header.y).toBeCloseTo(0, 0)
        expect(sidebar.width).toBeCloseTo(264, 0)
        expect(sidebar.y).toBeCloseTo(0, 0)
        expect(sidebar.height).toBeCloseTo(900, 0)
        if (dir === 'rtl') {
          expect(sidebar.x + sidebar.width).toBeCloseTo(1440, 0)
          expect(header.x + header.width).toBeCloseTo(1440 - 264, 0)
          expect(main.x + main.width).toBeCloseTo(1440 - 264, 0)
        } else {
          expect(sidebar.x).toBeCloseTo(0, 0)
          expect(header.x).toBeCloseTo(264, 0)
          expect(main.x).toBeCloseTo(264, 0)
        }
        await expect(page.getByTestId('module-rail')).toHaveCount(0)
      })
    }

    test(`the open application has a tinted tile in its block and its row is not a rail icon (${locale})`, async ({ page }) => {
      await open(page, FRAME, `locale:${locale};appearance:light`)
      const block = page.getByTestId('navigation-app-block')
      await expect(block).toHaveText(locale === 'ar' ? 'المشاريع' : 'Projects')
      await expect(page.getByTestId('navigation-app-back')).toHaveAttribute('href', '/apps')
      await expect(page.getByTestId('application-navigation')).toHaveCSS('background-color', 'rgb(250, 250, 250)')
    })
  }

  test('the day story shows the global sidebar with the active day row', async ({ page }) => {
    await open(page, 'shell-shellframe--day', 'locale:ar;appearance:light')
    const sidebar = page.getByTestId('application-navigation')
    await expect(sidebar).toHaveAttribute('data-mode', 'global')
    await expect(page.getByTestId('shell-org')).toBeVisible()
    await expect(page.getByTestId('core-app-home')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('navigation-app-projects')).toHaveAttribute('href', '/projects')
  })

  test('a branch folds on its own button and keeps the current route', async ({ page }) => {
    await open(page, 'shell-appsidebar--application', 'locale:ar;appearance:light')
    const current = page.url()
    const tasks = page.getByTestId('context-link-tasks')
    await expect(tasks).toHaveAttribute('aria-expanded', 'false')
    await tasks.click()
    await expect(page.getByTestId('submenu-tasks')).toBeVisible()
    await expect(page.getByTestId('context-link-projects')).toHaveAttribute('aria-expanded', 'true')
    await tasks.click()
    await expect(page.getByTestId('submenu-tasks')).toHaveCount(0)
    expect(page.url()).toBe(current)
  })

  test('[ has no action now: it neither folds the sidebar nor moves it', async ({ page }) => {
    await open(page, FRAME, 'locale:ar;appearance:light')
    const before = await box(page, 'application-navigation')
    await page.keyboard.press('BracketLeft')
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ج', code: 'BracketLeft', bubbles: true })))
    expect(await box(page, 'application-navigation')).toEqual(before)
    await expect(page.getByTestId('context-sidebar-toggle')).toHaveCount(0)
  })

  for (const [locale] of LOCALES) {
    test(`breadcrumb names the module and the current section (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellbreadcrumb--trail', `locale:${locale};appearance:light`)
      const trail = page.getByTestId('shell-breadcrumb')
      await expect(trail).toHaveAccessibleName(locale === 'ar' ? 'مسار الصفحة' : 'Breadcrumb')
      // This presentation story has explicit Arabic labels in both locale modes.
      await expect(trail.getByRole('link', { name: 'المشاريع', exact: true })).toHaveAttribute('href', '/projects')
      await expect(trail.locator('[aria-current="page"]')).toHaveText('المهام')
      await open(page, FRAME, `locale:${locale};appearance:light`)
      // The trail belongs to the page header, not to the top bar.
      await expect(page.getByTestId('shell-header').getByTestId('shell-breadcrumb')).toHaveCount(0)
      await expect(page.getByTestId('shell-header').locator('h1')).toHaveCount(0)
    })
  }

  test('header controls wait for nothing in Storybook and keep the search field and the tool sizes', async ({ page }) => {
    await open(page, FRAME, 'locale:ar;appearance:light')
    const search = page.getByTestId('global-search-trigger')
    await expect(search).toBeEnabled()
    await expect(search).toHaveAccessibleName('بحث')
    // Every icon button of the bar is one 40px button.
    for (const [id, size] of [['notification-bell', 40]] as const) {
      const area = await box(page, id)
      expect(area.width).toBeCloseTo(size, 0)
      expect(area.height).toBeCloseTo(size, 0)
    }
  })

  test('the top bar tools open the panel under the bar and Escape returns focus to the button', async ({ page }) => {
    await open(page, 'shell-apptopbar--default', 'locale:ar;appearance:light')
    const bell = page.getByTestId('notification-bell')
    await expect(bell).toBeEnabled()
    await bell.click()
    const panel = page.getByTestId('slide-over-notifications')
    await expect(panel).toBeVisible()
    expect((await panel.boundingBox())!.width).toBeCloseTo(380, 0)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(bell).toBeFocused()
  })

  test('the slide-over story keeps the title, the open-all link and the close button', async ({ page }) => {
    await open(page, 'shell-shellslideover--tasks', 'locale:ar;appearance:light')
    const panel = page.getByTestId('slide-over-tasks')
    await expect(panel.getByRole('heading', { name: 'مهامي' })).toBeVisible()
    await expect(page.getByTestId('slide-over-tasks-all')).toHaveAttribute('href', '/my-tasks')
    await expect(page.getByTestId('slide-over-tasks-close')).toBeVisible()
    await open(page, 'shell-shellslideover--closed', 'locale:ar;appearance:light')
    await expect(page.getByTestId('slide-over-tasks')).toBeHidden()
    await open(page, 'shell-shellslideover--no-all-link', 'locale:ar;appearance:light')
    await expect(page.getByTestId('slide-over-tasks-all')).toHaveCount(0)
  })
})

test.describe('Tasmim shell (tablet 900px)', () => {
  requireStorybook()
  test.use({ viewport: { width: 900, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of LOCALES) {
    test(`the sidebar is an 84px icon column with hidden labels (${locale})`, async ({ page }) => {
      await open(page, 'shell-shellframe--day', `locale:${locale};appearance:light`)
      expect((await box(page, 'application-navigation')).width).toBeCloseTo(84, 0)
      await expect(page.getByTestId('navigation-app-projects')).toHaveAccessibleName(locale === 'ar' ? 'المشاريع' : 'Projects')
      await expect(page.getByTestId('navigation-app-projects').locator('[data-slot="label"]')).toBeHidden()
      const main = await box(page, 'shell-main')
      if (dir === 'rtl') {
        expect(main.x).toBeCloseTo(0, 0)
        expect(main.x + main.width).toBeCloseTo(900 - 84, 0)
      } else {
        expect(main.x).toBeCloseTo(84, 0)
        expect(main.x + main.width).toBeCloseTo(900, 0)
      }
    })
  }
})

test.describe('Tasmim shell (390px)', () => {
  requireStorybook()
  test.use({ viewport: { width: 390, height: 844 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale] of LOCALES) {
    for (const fontSize of ['small', 'large'] as const) {
      test(`no sidebar column and a 60px top bar at 390px (${locale}, ${fontSize})`, async ({ page }) => {
        await open(page, FRAME, `locale:${locale};appearance:light;fontSize:${fontSize}`)
        await expect(page.getByTestId('application-navigation')).toBeHidden()
        const header = await box(page, 'shell-header')
        expect(header.x).toBeCloseTo(0, 0)
        expect(header.width).toBeCloseTo(390, 0)
        expect(header.height).toBeCloseTo(60, 0)
        // The search stays as an icon button and the bell stays; the tools the tab bar covers drop out.
        await expect(page.getByTestId('global-search-trigger')).toBeVisible()
        await expect(page.getByTestId('notification-bell')).toBeVisible()
        await expect(page.getByTestId('chat-tool')).toBeHidden()
        for (const control of await page.getByTestId('shell-header').getByRole('button').all()) {
          const area = (await control.boundingBox())!
          expect(area.x + area.width).toBeLessThanOrEqual(390)
          expect(area.x).toBeGreaterThanOrEqual(0)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    }
  }

  test('the drawer story is the sidebar content on a flat surface', async ({ page }) => {
    await open(page, 'shell-appsidebar--drawer', 'locale:ar;appearance:light')
    const menu = page.getByTestId('mobile-application-navigation')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('data-surface', 'drawer')
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(390)
  })

  test('the tab bar story draws five destinations and lights the current one', async ({ page }) => {
    await open(page, 'shell-shelltabbar--today', 'locale:ar;appearance:light')
    const bar = page.getByTestId('shell-tabbar')
    await expect(bar.locator('a, button')).toHaveCount(5)
    await expect(bar.getByRole('link', { name: 'يومي', exact: true })).toHaveAttribute('data-active', 'true')
    await expect(bar.getByTestId('tab-more')).not.toHaveAttribute('data-active', 'true')
    for (const tab of await bar.locator('a, button').all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await open(page, 'shell-shelltabbar--more-lit', 'locale:ar;appearance:light')
    await expect(page.getByTestId('shell-tabbar').getByTestId('tab-more')).toHaveAttribute('data-active', 'true')
  })
})

test.describe('Tasmim command palette', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'بحث', exact: true })

  for (const chord of ['Meta+k', 'Control+k'] as const) {
    test(`${chord} opens the palette with its input focused and toggles it closed`, async ({ page }) => {
      await open(page, FRAME, 'locale:ar;appearance:light')
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
    await open(page, FRAME, 'locale:ar;appearance:light')
    await page.getByTestId('global-search-trigger').click()
    await page.keyboard.type('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await expect(dialog(page).getByRole('option', { name: 'مهامي', exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByTestId('navigation-app-block')).toHaveText('المشاريع')
  })

  test('Esc closes and returns focus to the trigger, or to the element ⌘K was pressed on', async ({ page }) => {
    await open(page, FRAME, 'locale:ar;appearance:light')
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
    await open(page, FRAME, 'locale:ar;appearance:light')
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
    await open(page, FRAME, 'locale:ar;appearance:light')
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await page.keyboard.press('Shift+Slash')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toHaveAttribute('data-view', 'shortcuts')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(palette.getByRole('option', { name: /فتح لوحة الأوامر/ })).toBeVisible()
    await palette.getByRole('textbox').fill('المشاريع')
    await expect(palette.getByRole('option', { name: /الانتقال إلى المشاريع/ })).toContainText('P')
    await palette.getByRole('textbox').fill('')
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
