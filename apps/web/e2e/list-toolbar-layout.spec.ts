import { expect, test, type Page } from '@playwright/test'

// The converted HR lists keep one toolbar row (search, one «فلاتر» popover, state segments) and a table that fits its card.
// From 1280px up the table needs no inner scroll; below that it may scroll inside the card, never clip. Isolated mock stack (admin / admin).
const ROUTES = ['/hr/warnings', '/hr/insurance', '/hr/assets', '/hr/recruitment', '/hr/recruitment/jobs']
const WIDTHS = [375, 768, 1024, 1280, 1600]

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function switchLanguage(page: Page, dir: 'rtl' | 'ltr') {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('account-menu')).toBeEnabled()
  await page.getByTestId('account-menu').click()
  await page.getByTestId('user-menu-language').getByRole('button', { name: dir === 'ltr' ? 'English' : 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', dir)
}

/** Runs in the page: toolbar controls outside the viewport, and table cells clipped by the card (not reachable by scrolling). */
function collectProblems(minWidthForNoScroll: number): string[] {
  const problems: string[] = []
  const card = document.querySelector('[data-slot="list-card"]')
  if (!card) return ['no list card']
  const cardBox = card.getBoundingClientRect()
  for (const el of card.querySelectorAll('[data-slot="inline-filter-bar"] > div > *')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.left < -1 || r.right > innerWidth + 1)) problems.push(`toolbar control leaves the viewport (${Math.round(r.left)}..${Math.round(r.right)})`)
  }
  const table = card.querySelector('table')
  if (table && table.getBoundingClientRect().width > 0) {
    // The nearest scrolling ancestor of the table is the card's inner scroller; clipping means it hides content without scrolling.
    let scroller: Element | null = table.parentElement
    while (scroller && scroller !== card && getComputedStyle(scroller).overflowX === 'visible') scroller = scroller.parentElement
    const scrollable = !!scroller && scroller !== card && scroller.scrollWidth > scroller.clientWidth + 1
    if (innerWidth >= minWidthForNoScroll && scrollable) problems.push(`table scrolls inside its card at ${innerWidth}px`)
    if (!scrollable) {
      for (const th of table.querySelectorAll('th')) {
        const r = th.getBoundingClientRect()
        if (r.width > 0 && (r.left < cardBox.left - 1 || r.right > cardBox.right + 1)) problems.push(`column "${(th.textContent ?? '').trim()}" is clipped by the card`)
      }
    }
  }
  return problems
}

for (const dir of ['rtl', 'ltr'] as const) {
  for (const width of WIDTHS) {
    test(`converted HR lists fit at ${width}px (${dir})`, async ({ page }) => {
      test.setTimeout(240_000)
      await login(page)
      await switchLanguage(page, dir)
      try {
        await page.setViewportSize({ width, height: 900 })
        const failures: string[] = []
        for (const route of ROUTES) {
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          await expect(page.getByTestId('shell-main')).toBeVisible()
          await page.waitForTimeout(600)
          for (const problem of await page.evaluate(collectProblems, 1280)) failures.push(`${route}: ${problem}`)
        }
        expect(failures).toEqual([])
      } finally {
        if (dir === 'ltr') await switchLanguage(page, 'rtl')
      }
    })
  }
}
