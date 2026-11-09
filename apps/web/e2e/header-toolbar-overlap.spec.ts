import { expect, test, type Page } from '@playwright/test'

// The page header (title, tag chips, actions) and the filter toolbar never overlap or clip, in RTL and LTR, from phone to desktop.
// Isolated mock stack (admin / admin).
const WIDTHS = [375, 768, 1024, 1280]
const ROUTES = ['/inbox/reports', '/inbox', '/projects', '/tasks', '/crm', '/crm/opportunities', '/hr', '/finance', '/documents', '/meetings', '/appointments', '/settings']

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

/** Runs in the page: the boxes of the header parts and of the toolbar controls, and every pair that intersects or leaves the viewport. */
function collectProblems(): string[] {
  type Part = { name: string; el: Element }
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  // A `display: contents` wrapper has no box of its own: its children are the controls.
  const leaves = (el: Element): Element[] => [...el.children].flatMap(c => getComputedStyle(c).display === 'contents' ? leaves(c) : [c]).filter(visible)
  const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('data-slot') ? `[${el.getAttribute('data-slot')}]` : ''}"${(el.textContent ?? '').trim().slice(0, 24)}"`
  const groups: Part[][] = []
  const header = document.querySelector('[data-slot="page-header"]')
  if (header) {
    const title = header.querySelector('h1, h2')
    const parts: Part[] = []
    if (title && visible(title)) {
      parts.push({ name: 'title', el: title })
      // A short title is as narrow as its own text, so width alone proves nothing: the failure is a title that WRAPS inside a narrow box.
      const style = getComputedStyle(title)
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3
      const box = title.getBoundingClientRect()
      const lines = Math.round(box.height / lineHeight)
      if (lines > 3) return [`title wraps to ${lines} lines`]
      if (lines > 1 && box.width < 120) return [`title squeezed to ${Math.round(box.width)}px over ${lines} lines`]
    }
    // The tag pills: every text-bearing leaf beside the title (not inside it), found without relying on the wrapper's markup.
    const beside = title?.parentElement
    if (title && beside) {
      const pills = [...beside.querySelectorAll('*')].filter(el => !title.contains(el) && (el.textContent ?? '').trim() && ![...el.children].some(c => (c.textContent ?? '').trim()))
      for (const tag of pills) if (visible(tag)) parts.push({ name: `tag ${label(tag)}`, el: tag })
    }
    const actions = header.querySelector('[data-slot="page-header-row"] > .ms-auto')
    if (actions && visible(actions)) for (const a of leaves(actions)) parts.push({ name: `action ${label(a)}`, el: a })
    groups.push(parts)
  }
  for (const row of document.querySelectorAll('[data-slot="filter-row"], [data-slot="inline-filter-bar"] > div')) {
    groups.push(leaves(row).map(el => ({ name: `control ${label(el)}`, el })))
  }
  const problems: string[] = []
  for (const parts of groups) {
    for (const p of parts) {
      const r = p.el.getBoundingClientRect()
      if (r.left < -1 || r.right > innerWidth + 1) problems.push(`${p.name} leaves the viewport (${Math.round(r.left)}..${Math.round(r.right)})`)
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!.el.getBoundingClientRect()
        const b = parts[j]!.el.getBoundingClientRect()
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (overlapX > 1 && overlapY > 1) problems.push(`${parts[i]!.name} overlaps ${parts[j]!.name}`)
      }
    }
  }
  return problems
}

// One test per direction and width, so a slow dev server fails one case instead of the whole sweep.
for (const dir of ['rtl', 'ltr'] as const) {
  for (const width of WIDTHS) {
    test(`header chips and toolbar controls do not collide at ${width}px (${dir})`, async ({ page }) => {
      test.setTimeout(240_000)
      await login(page)
      await switchLanguage(page, dir)
      try {
        await page.setViewportSize({ width, height: 900 })
        const failures: string[] = []
        for (const route of ROUTES) {
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          await expect(page.getByTestId('shell-main')).toBeVisible()
          await expect(page.locator('html')).toHaveAttribute('dir', dir)
          await page.waitForTimeout(400)
          for (const problem of await page.evaluate(collectProblems)) failures.push(`${route}: ${problem}`)
        }
        expect(failures).toEqual([])
      } finally {
        if (dir === 'ltr') await switchLanguage(page, 'rtl')
      }
    })
  }
}
