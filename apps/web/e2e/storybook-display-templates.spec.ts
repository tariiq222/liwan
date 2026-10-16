import { expect, test, type Locator, type Page } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

// Behaviour of the Plan 4 display templates on their stories: dashboard (Task 10),
// timeline and conversation (Task 11), standalone and print (Task 12).
let base = ''
let close: () => Promise<void> = async () => {}
const open = async (page: Page, id: string, globals: string) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`)
  await page.locator('#storybook-root').waitFor()
}
const boxOf = async (locator: Locator) => (await locator.boundingBox())!

test.describe('Tasmim dashboard template', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('charts sit two-up on a wide screen, the wide chart spans both, and all stack on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, 'shared-dashboardpage--default', 'locale:ar;appearance:light')
    const panels = page.locator('[data-template="chart-panel"]')
    await expect(panels).toHaveCount(3)
    const [first, second, wide] = [await boxOf(panels.nth(0)), await boxOf(panels.nth(1)), await boxOf(panels.nth(2))]
    expect(first.y).toBeCloseTo(second.y, 0)
    expect(wide.y).toBeGreaterThan(first.y + first.height)
    expect(wide.width).toBeGreaterThan(first.width + second.width)
    // RTL: the first chart is on the inline-start (right) side.
    expect(first.x).toBeGreaterThan(second.x)

    await page.setViewportSize({ width: 390, height: 844 })
    const narrow = [await boxOf(panels.nth(0)), await boxOf(panels.nth(1))]
    expect(narrow[1]!.y).toBeGreaterThan(narrow[0]!.y + narrow[0]!.height)
    expect(narrow[0]!.width).toBeCloseTo(narrow[1]!.width, 0)
  })

  test('a chart panel is a region named by its heading', async ({ page }) => {
    await open(page, 'shared-chartpanel--with-actions', 'locale:en;appearance:light')
    const region = page.getByRole('region', { name: 'Planned versus actual' })
    await expect(region).toBeVisible()
    await expect(region.getByRole('combobox')).toBeEnabled()
  })
})

test.describe('Tasmim standalone page and print sheet', () => {
  requireStorybook()
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const appearance of ['light', 'dark'] as const) {
    test(`print drops the shell and prints the page black on white (${appearance})`, async ({ page }) => {
      await open(page, 'shared-standalonepage--print-in-shell', `locale:ar;appearance:${appearance}`)
      const sheet = page.locator('.nasq-print')
      await expect(page.getByTestId('shell-header')).toBeVisible()
      await expect(page.getByTestId('module-rail')).toBeVisible()
      if (appearance === 'dark') await expect(sheet).not.toHaveCSS('color', 'rgb(0, 0, 0)')

      await page.emulateMedia({ media: 'print' })
      for (const id of ['shell-header', 'module-rail', 'context-sidebar']) await expect(page.getByTestId(id)).toBeHidden()
      await expect(sheet.locator('.nasq-print-hide')).toBeHidden()
      await expect(sheet).toHaveCSS('color', 'rgb(0, 0, 0)')
      await expect(sheet).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(sheet.getByRole('heading', { level: 1 })).toHaveCSS('color', 'rgb(0, 0, 0)')
      await expect(sheet.locator('dt').first()).toHaveCSS('color', 'rgb(0, 0, 0)')
      for (const target of [page.locator('body'), page.getByTestId('shell-main')]) {
        await expect(target).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      }
      const main = await boxOf(page.getByTestId('shell-main'))
      expect(main.x).toBeCloseTo(0, 0)
      expect(main.y).toBeCloseTo(0, 0)
      expect(main.width).toBeGreaterThan(1400)
    })
  }

  test('the card variant is the page main and centres its card', async ({ page }) => {
    await open(page, 'shared-standalonepage--card', 'locale:ar;appearance:light')
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const card = await boxOf(page.locator('[data-template="standalone-page"] form'))
    expect(card.x + card.width / 2).toBeCloseTo(720, -1)
  })
})

test.describe('Tasmim timeline template', () => {
  requireStorybook()
  test.use({ viewport: { width: 1280, height: 800 } })
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
    test(`previous sits at the inline start and both chevrons point outward (${locale})`, async ({ page }) => {
      await open(page, 'shared-timelineframe--calendar', `locale:${locale};appearance:light`)
      const prev = page.getByTestId('timeline-prev')
      const next = page.getByTestId('timeline-next')
      await expect(prev).toBeEnabled()
      const [p, n] = [await boxOf(prev), await boxOf(next)]
      if (dir === 'rtl') expect(p.x).toBeGreaterThan(n.x)
      else expect(p.x).toBeLessThan(n.x)
      const scaleOf = (button: typeof prev) => button.locator('[class*="-scale-x-100"]').evaluate(element => getComputedStyle(element).scale)
      for (const button of [prev, next]) {
        const scale = await scaleOf(button)
        if (dir === 'rtl') expect(scale.startsWith('-1')).toBe(true)
        else expect(scale).toBe('none')
      }
    })
  }

  test('previous, next and today move the announced range', async ({ page }) => {
    await open(page, 'shared-timelineframe--calendar', 'locale:en;appearance:light')
    const range = page.getByTestId('timeline-range')
    await expect(range).toHaveText('October 2026')
    await expect(range).toHaveAttribute('aria-live', 'polite')
    await page.getByTestId('timeline-next').click()
    await expect(range).toHaveText('November 2026')
    await page.getByTestId('timeline-prev').click()
    await page.getByTestId('timeline-prev').click()
    await expect(range).toHaveText('September 2026')
    await page.getByTestId('timeline-today').click()
    await expect(range).toHaveText('October 2026')
  })

  test('the scale switch is a group of pressed toggles', async ({ page }) => {
    await open(page, 'shared-timelineframe--schedule', 'locale:en;appearance:light')
    const group = page.getByRole('group', { name: 'Scale' })
    const month = group.getByRole('button', { name: 'Month' })
    await expect(group.getByRole('button', { pressed: true })).toHaveCount(1)
    await month.click()
    await expect(month).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('timeline-range')).toHaveText('October 2026')
  })
})

test.describe('Tasmim conversation template', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  test('desktop shows the thread or the empty state, never the list; info sits at the inline end', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'shared-conversationlayout--nothing-selected', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-empty"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-list"]')).toHaveCount(0)
    await open(page, 'shared-conversationlayout--info', 'locale:ar;appearance:light')
    const thread = await boxOf(page.locator('[data-template="conversation-thread"]'))
    const info = await boxOf(page.getByRole('complementary', { name: 'التفاصيل' }))
    expect(info.width).toBeLessThan(thread.width)
    expect(info.x).toBeLessThan(thread.x)
    const composer = await boxOf(page.locator('[data-template="conversation-composer"]'))
    expect(composer.y + composer.height).toBeCloseTo(900, 0)
  })

  test('a phone shows the list, then the thread, then info, one at a time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, 'shared-conversationlayout--nothing-selected', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-list"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toHaveCount(0)
    await open(page, 'shared-conversationlayout--selected', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-thread"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-list"]')).toHaveCount(0)
    await open(page, 'shared-conversationlayout--info', 'locale:ar;appearance:light')
    await expect(page.locator('[data-template="conversation-info"]')).toBeVisible()
    await expect(page.locator('[data-template="conversation-thread"]')).toBeHidden()
  })
})

test.describe('commercial quote recomputation', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })
  test('retains the quote amounts while visibly announcing recalculation', async ({ page }) => {
    await open(page, 'shared-commerce-pricebreakdown--recomputing', 'locale:en;appearance:light')
    const quote = page.locator('[data-slot="price-breakdown"]')
    await expect(quote).toHaveAttribute('aria-busy', 'true')
    await expect(quote.getByRole('status')).toHaveText('Calculating…')
    await expect(quote.locator('[data-slot="invoice-lines"]')).toBeVisible()
    await expect(quote).toContainText(/SAR\s+414\.00/)
    expect(await quote.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
  })
})
