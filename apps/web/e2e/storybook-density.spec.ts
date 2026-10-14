import { expect, test } from '@playwright/test'
import { requireStorybook, startStorybookServer } from './support/storybookServer'

let base = ''
let close: () => Promise<void> = async () => {}
const url = (id: string, globals: string) => `${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}`

test.describe('Tasmim density', () => {
  requireStorybook()
  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const [globals, root] of [
    ['locale:ar;appearance:light;fontSize:small', 14],
    ['locale:en;appearance:light;fontSize:small', 13],
    ['locale:ar;appearance:dark;fontSize:large', 18],
    ['locale:en;appearance:light;fontSize:large', 17],
  ] as const) {
    test(`controls and rows scale with a ${root}px root (${globals})`, async ({ page }) => {
      await page.goto(url('foundations-density--controls', globals))
      const scale = root / 14
      const button = await page.getByTestId('density-button').boundingBox()
      const input = await page.locator('input[data-testid="density-input"]').boundingBox()
      expect(Math.abs(button!.height - 32 * scale)).toBeLessThanOrEqual(1)
      expect(Math.abs(input!.height - 32 * scale)).toBeLessThanOrEqual(1)
      const xs = await page.getByTestId('density-button-xs').boundingBox()
      const sm = await page.getByTestId('density-button-sm').boundingBox()
      const icon = await page.getByTestId('density-button-icon').boundingBox()
      expect(xs!.height).toBeLessThan(button!.height)
      expect(sm!.height).toBeLessThan(button!.height)
      expect(Math.abs(icon!.width - icon!.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(icon!.height - button!.height)).toBeLessThanOrEqual(1)
      const radius = await page.getByTestId('density-button').evaluate(el => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius))
      expect(Math.abs(radius - 6 * scale)).toBeLessThanOrEqual(0.6)

      await page.goto(url('foundations-density--table', globals))
      const row = await page.getByTestId('density-table').locator('tbody tr').first().boundingBox()
      expect(Math.abs(row!.height - 36 * scale)).toBeLessThanOrEqual(1)
      const cardRadius = await page.getByTestId('density-card').evaluate(el => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius))
      expect(Math.abs(cardRadius - 8 * scale)).toBeLessThanOrEqual(0.6)
    })

    test(`card header aligns with the body at 1024px (${globals})`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.goto(url('foundations-density--table', globals))
      const card = page.getByTestId('density-card')
      const inlineStart = (slot: string) => card.locator(`[data-slot="${slot}"]`).evaluate(el => Number.parseFloat(getComputedStyle(el).paddingInlineStart))
      expect(Math.abs(await inlineStart('header') - await inlineStart('body'))).toBeLessThanOrEqual(0.5)
    })
  }
})
