import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: the project overview (/projects/1) on SharedRecordPage inside the workspace frame
// (isolated mock stack). Project 1 is «مشروع ألفا» (2026-01-01 to 2035-12-31) with two open tasks, one follower and the milestone «اعتماد الخطة».
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
    name: 'liwan-appearance',
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

    test('the frame keeps the only h1 and the overview adds exactly its section headings', async ({ page }) => {
      await open(page, '/projects/1')
      await expect(page.getByTestId('project-overview')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
      const headings = await page.locator('main h2').allTextContents()
      expect(headings.map(text => text.trim())).toEqual(['الانتقال إلى مرحلة التنفيذ', 'يحتاج انتباهك', 'آخر تحديث'])
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      // The overview's own page header carries actions only; the name is the frame's.
      await expect(page.locator('[data-template="record"] [data-slot="page-header"]').getByRole('heading')).toHaveCount(0)
      await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
    })

    test('metrics and sections show the project facts once', async ({ page }) => {
      await open(page, '/projects/1')
      const tiles = page.getByTestId('metric-tile')
      await expect(tiles).toHaveCount(4)
      await expect(tiles.nth(0)).toContainText('المهام المفتوحة')
      await expect(tiles.nth(1)).toContainText('أقرب معلم')
      await expect(tiles.nth(1)).toContainText('اعتماد الخطة')
      await expect(tiles.nth(2)).toContainText('المعالم')
      await expect(tiles.nth(3)).toContainText('المتابعون')
      await expect(page.getByTestId('project-active-tasks')).toBeVisible()
      await expect(page.getByTestId('project-overview-progress')).toBeVisible()
      await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
      // The overview has no properties panel: the facts live in the frame and the tiles.
      await expect(page.getByRole('complementary', { name: 'الخصائص' })).toHaveCount(0)
      // Status and manager live in the frame only: one project-status on the page.
      await expect(page.getByTestId('project-status')).toHaveCount(1)
      await expect(page.getByTestId('project-overview').getByTestId('project-status-select')).toHaveCount(0)
    })

    for (const fontSize of fontSizes) {
      const suffix = fontSize === 'small' ? '' : ` with ${fontSize} text`
      test(`the milestone, count and follower tiles sit in one row${suffix}`, async ({ page, baseURL }) => {
        await setAppearance(page, baseURL, fontSize)
        await open(page, '/projects/1')
        await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
        await expect(page.getByTestId('metric-tile')).toHaveCount(4)
        // The open-tasks tile has its own row under the progress card; the other three share one.
        const rowTiles = page.getByTestId('metric-tile').filter({ hasNotText: 'المهام المفتوحة' })
        const dateValue = page.getByTestId('metric-tile').nth(1).locator('p.text-highlighted')
        await expect(dateValue).toContainText('2026')
        await expect.poll(async () => {
          const tops = await rowTiles.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y))
          return Math.max(...tops) - Math.min(...tops)
        }).toBeLessThanOrEqual(1)
        // Painted value glyphs must stay inside their column. Document width
        // alone misses text clipped by the card when the font is enlarged.
        const clippedValues = await rowTiles.evaluateAll(tiles => tiles.flatMap(tile => {
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
        // Dates are dd/MM/yyyy in every locale (utils/formatDate.ts), isolated left to right: day, month, year.
        expect(dateParts.day.right).toBeLessThanOrEqual(dateParts.month.left + 1)
        expect(dateParts.month.right).toBeLessThanOrEqual(dateParts.year.left + 1)
        expect(await fitsWidth(page)).toBe(true)
      })
    }

    test('a project without dates shows no date tag', async ({ page }) => {
      await open(page, '/projects?view=table')
      // Opened from the list, the project is fetched by the browser, so the response can be replaced.
      await page.route('**/api/v1/projects/1', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: { ...body, date_start: null, date_end: null } })
      })
      await page.getByTestId('project-row').first().click()
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
      await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
      await expect(page.getByTestId('project-workspace-dates')).toHaveCount(0)
    })

    test('a project that cannot be read keeps the not-found text and its way back', async ({ page }) => {
      await page.goto('/projects/999')
      await expect(page.getByText('المشروع غير موجود أو لا تملك صلاحية عرضه')).toBeVisible()
      await expect(page.getByRole('link', { name: 'العودة إلى المشاريع' })).toBeVisible()
      await expect(page.locator('[data-template="record"]')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    for (const fontSize of fontSizes) {
      const suffix = fontSize === 'small' ? '' : ` with ${fontSize} text`
      test(`on a 390px phone the sections stack and nothing overflows${suffix}`, async ({ page, baseURL }) => {
        await setAppearance(page, baseURL, fontSize)
        await open(page, '/projects/1')
        await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
        const progress = await page.getByTestId('project-overview-progress').boundingBox()
        const latest = await page.getByTestId('project-overview-latest-update').boundingBox()
        expect(latest!.y).toBeGreaterThanOrEqual(progress!.y + progress!.height - 1)
        expect(await fitsWidth(page)).toBe(true)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      })
    }
  })
})
