import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: the project overview (/projects/1) on SharedRecordPage inside the workspace frame
// (isolated mock stack). Project 1 is «مشروع ألفا» with start 2026-01-01 and one follower.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const fontSizes = ['small', 'medium', 'large'] as const
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function setAppearance(page: Page, baseURL: string | undefined, fontSize: typeof fontSizes[number]) {
  expect(baseURL).toBeDefined()
  const response = await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: fontSize } })
  expect(response.status()).toBe(200)
  await page.context().addCookies([{
    name: 'nasq-appearance',
    value: encodeURIComponent(JSON.stringify({ mode: 'light', fontSize })),
    url: baseURL!,
  }])
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the project overview', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await login(page)
    await setAppearance(page, baseURL, 'small')
  })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the frame keeps the only h1 and the overview adds exactly its two section headings', async ({ page }) => {
      await open(page, '/projects/1')
      await expect(page.getByTestId('project-overview')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['يحتاج انتباهك', 'آخر تحديث'])
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.locator('[data-template="record"] [data-slot="page-header"]')).toHaveCount(0)
      await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
    })

    test('metrics, sections and the properties aside show the project facts once', async ({ page }) => {
      await open(page, '/projects/1')
      await expect(page.getByTestId('metric-tile')).toHaveCount(3)
      await expect(page.getByTestId('project-active-tasks')).toBeVisible()
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      await expect(aside).toBeVisible()
      await expect(aside.locator('[data-slot="property-row"]')).toHaveCount(5)
      await expect(aside.getByText('تاريخ البدء')).toBeVisible()
      await expect(aside.getByText('المعالم')).toBeVisible()
      await expect(aside.getByText('المتابعون')).toBeVisible()
      // Status and manager live in the frame only: one project-status on the page.
      await expect(page.getByTestId('project-status')).toHaveCount(1)
      await expect(page.getByTestId('project-overview').getByTestId('project-status-select')).toHaveCount(0)
    })

    for (const fontSize of fontSizes) {
      const suffix = fontSize === 'small' ? '' : ` with ${fontSize} text`
      test(`the three metric tiles sit in one row beside the aside${suffix}`, async ({ page, baseURL }) => {
        await setAppearance(page, baseURL, fontSize)
        await open(page, '/projects/1')
        await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
        await expect(page.getByTestId('metric-tile')).toHaveCount(3)
        const dateValue = page.getByTestId('metric-tile').last().locator('p.text-highlighted')
        await expect(dateValue).toContainText('2026')
        await expect.poll(async () => {
          const tops = await page.getByTestId('metric-tile').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y))
          return Math.max(...tops) - Math.min(...tops)
        }).toBeLessThanOrEqual(1)
        // Painted value glyphs must stay inside their column. Document width
        // alone misses text clipped by the card when the font is enlarged.
        const clippedValues = await page.getByTestId('metric-tile').evaluateAll(tiles => tiles.flatMap(tile => {
          const value = tile.querySelector<HTMLElement>('p.text-highlighted')!
          const box = value.parentElement!.getBoundingClientRect()
          const card = tile.getBoundingClientRect()
          const text = document.createTreeWalker(value, NodeFilter.SHOW_TEXT)
          let clipped = box.left < card.left - 1 || box.right > card.right + 1
          while (text.nextNode()) {
            const range = document.createRange()
            range.selectNodeContents(text.currentNode)
            clipped ||= [...range.getClientRects()].some(rect => rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1))
          }
          return clipped ? [value.textContent?.trim()] : []
        }))
        expect(clippedValues).toEqual([])
        // A calendar date stays whole; splitting a bidi-formatted year across
        // lines can change the visually read order even when every glyph fits.
        expect(await dateValue.evaluate(value => value.getBoundingClientRect().height - parseFloat(getComputedStyle(value).lineHeight))).toBeLessThanOrEqual(1)
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        const dateParts = await dateValue.evaluate(value => {
          const text = [...value.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('2026'))!
          const rect = (part: string) => {
            const start = text.textContent!.indexOf(part)
            const range = document.createRange()
            range.setStart(text, start)
            range.setEnd(text, start + part.length)
            const box = range.getBoundingClientRect()
            return { left: box.left, right: box.right }
          }
          return { day: rect('01'), month: rect('10'), year: rect('2026') }
        })
        // The localized Arabic date is read from the right: day, month, year.
        expect(dateParts.year.right).toBeLessThanOrEqual(dateParts.month.left + 1)
        expect(dateParts.month.right).toBeLessThanOrEqual(dateParts.day.left + 1)
        expect(await fitsWidth(page)).toBe(true)
      })
    }

    test('a project without dates shows dashes with a spoken «لا قيمة»', async ({ page }) => {
      await open(page, '/projects?view=table')
      // Opened from the list, the project is fetched by the browser, so the response can be replaced.
      await page.route('**/api/v1/projects/1', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: { ...body, date_start: null, date_end: null } })
      })
      await page.getByTestId('project-row').first().click()
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
      const aside = page.getByRole('complementary', { name: 'الخصائص' })
      const start = aside.locator('[data-slot="property-row"]').filter({ hasText: 'تاريخ البدء' })
      await expect(start.locator('dd')).toContainText('—')
      await expect(start.locator('dd .sr-only')).toHaveText('لا قيمة')
    })

    test('a project that cannot be read keeps the not-found text and its way back', async ({ page }) => {
      await page.goto('/projects/999')
      await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
      await expect(page.getByRole('button', { name: 'العودة إلى المشاريع' })).toBeVisible()
      await expect(page.locator('[data-template="record"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    for (const fontSize of fontSizes) {
      const suffix = fontSize === 'small' ? '' : ` with ${fontSize} text`
      test(`on a 390px phone the properties follow the sections and nothing overflows${suffix}`, async ({ page, baseURL }) => {
        await setAppearance(page, baseURL, fontSize)
        await open(page, '/projects/1')
        await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
        const section = await page.getByTestId('project-overview-latest-update').boundingBox()
        const aside = await page.getByRole('complementary', { name: 'الخصائص' }).boundingBox()
        expect(aside!.y).toBeGreaterThanOrEqual(section!.y + section!.height - 1)
        expect(await fitsWidth(page)).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      })
    }
  })
})
