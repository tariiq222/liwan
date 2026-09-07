import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHOTS = process.env.INTERNAL_UI_AUDIT_SHOTS
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/internal-ui-audit')

const ROUTES = [
  { id: 'tasks', path: '/tasks', width: 'list', h1: 'مهامي' },
  { id: 'projects', path: '/projects', width: 'list', h1: 'المشاريع' },
  { id: 'project-detail', path: '/projects/1', width: 'detail', h1: 'مشروع ألفا' },
  { id: 'project-settings', path: '/projects/1/settings', width: 'form', h1: 'إعدادات المشروع' },
  { id: 'project-charter', path: '/projects/1/charter', width: 'form', h1: 'ميثاق المشروع' },
  { id: 'hr', path: '/hr', width: 'list', h1: 'الأشخاص' },
  { id: 'employee-new', path: '/hr/employees/new', width: 'form', h1: 'موظف جديد' },
  { id: 'account', path: '/account', width: 'form', h1: 'الحساب' },
  { id: 'settings-users', path: '/settings/users', width: null, h1: 'المستخدمون' },
  { id: 'settings-appearance', path: '/settings/appearance', width: null, h1: 'المظهر' },
  { id: 'catalog-new', path: '/settings/projects/catalogs/types/new', width: 'form', h1: 'نوع مشروع جديد' },
  { id: 'notifications', path: '/notifications', width: 'form', h1: 'الإشعارات' },
  { id: 'chat', path: '/chat', width: 'list', h1: 'المحادثة' },
  { id: 'search', path: '/search', width: 'form', h1: 'بحث' },
  { id: 'reports', path: '/reports', width: 'list', h1: 'التقارير' },
] as const

test.describe.configure({ timeout: 90_000 })
test.skip(
  process.env.E2E_BASE_URL !== 'http://127.0.0.1:4387' || !process.env.INTERNAL_UI_AUDIT_SHOTS,
  'Run with internal-ui-audit-with-server.py; these cases require the isolated mock API.',
)

function shot(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  return path.join(SHOTS, name)
}

async function login(page: Page) {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'دخول', exact: true })
  await expect(submit).toBeEnabled({ timeout: 60_000 })
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await submit.click()
  await expect(page).toHaveURL(/\/tasks$/, { timeout: 30_000 })
  await expect(page.locator('h1').first()).toBeVisible()
}

async function setAppearance(page: Page, mode: 'light' | 'dark', fontSize: 'medium' | 'large') {
  await page.context().addCookies([{
    name: 'nasq-appearance',
    value: JSON.stringify({ mode, fontSize }),
    url: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4387',
  }])
}

function attachErrorProbe(page: Page) {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(String(err)))
  return errors
}

async function assertNoErrorPage(page: Page) {
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('تعذّر الوصول إلى الخادم')
  expect(text).not.toContain('استجابة غير صالحة من الخادم')
  expect(await page.locator('.nuxt-error-page, [data-testid="nuxt-error"]').count()).toBe(0)
}

async function assertH1(page: Page, expected: string) {
  const h1 = page.locator('h1').first()
  await expect(h1).toBeVisible()
  await expect(h1).toHaveText(expected)
}

async function visit(page: Page, route: (typeof ROUTES)[number], opts: { checkWidth: boolean; checkForm: boolean }) {
  const defects: string[] = []
  await page.goto(route.path)
  await assertH1(page, route.h1)
  await expect(page.getByRole('button', { name: 'بحث', exact: true })).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  if (route.id === 'projects') await expect(page.getByTestId('project-row')).toHaveCount(3)
  if (route.id === 'tasks') await expect(page.locator('.nasq-status-chip-success')).not.toHaveCount(0)
  await assertNoErrorPage(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 1) defects.push(`overflow ${overflow}px`)
  if (route.id === 'chat' || route.id === 'notifications') {
    const layout = await page.locator('[data-slot="page-container"]').first().evaluate((container) => {
      const header = container.querySelector('[data-slot="page-header"]')!
      return { display: getComputedStyle(container).display, headerHeight: header.getBoundingClientRect().height }
    })
    if (layout.display !== 'flex') defects.push(`full-height page overrides flex: ${layout.display}`)
    if (layout.headerHeight > 96) defects.push(`stretched page header: ${layout.headerHeight}px`)
  }
  if (opts.checkWidth && route.width) {
    const count = await page.locator(`[data-slot="page-container"][data-layout-width="${route.width}"]`).count()
    if (!count) defects.push(`missing page-container width=${route.width}`)
  }
  if (opts.checkForm && (route.id === 'employee-new' || route.id === 'account' || route.id === 'catalog-new' || route.id === 'project-settings' || route.id === 'project-charter')) {
    const formish = page.locator('form, [data-testid="project-settings-page"], input').first()
    if (!await formish.isVisible()) defects.push('missing visible form')
  }
  return { overflow, defects }
}

async function measureChipContrast(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number] | null => {
      const rgb = value.match(/rgba?\(\s*([\d.]+)\s*[,\s/]\s*([\d.]+)\s*[,\s/]\s*([\d.]+)/)
      if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      const srgb = value.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
      if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255]
      return null
    }
    const viaCanvas = (css: string): [number, number, number] | null => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' } as CanvasRenderingContext2DSettings)
      if (!ctx) return null
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const data = ctx.getImageData(0, 0, 1, 1).data
      if (data[3] === 0) return null
      return [data[0], data[1], data[2]]
    }
    const viaMap = (el: Element, prop: 'color' | 'background-color'): [number, number, number] | null => {
      const map = (el as HTMLElement).computedStyleMap?.().get(prop) as { r?: { value: number; unit: string }; g?: { value: number }; b?: { value: number } } | undefined
      if (!map?.r || !map.g || !map.b) return null
      const scale = map.r.unit === 'percent' ? 2.55 : 1
      return [map.r.value * scale, map.g.value * scale, map.b.value * scale]
    }
    const linC = (c: number) => {
      const x = Math.min(Math.max(c, 0), 255) / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    const ratio = (fg: [number, number, number], bg: [number, number, number]) => {
      const L1 = 0.2126 * linC(fg[0]) + 0.7152 * linC(fg[1]) + 0.0722 * linC(fg[2])
      const L2 = 0.2126 * linC(bg[0]) + 0.7152 * linC(bg[1]) + 0.0722 * linC(bg[2])
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    }
    const pick = (el: Element | null) => {
      if (!el) return null
      const style = getComputedStyle(el)
      const fg = viaMap(el, 'color') || parse(style.color) || viaCanvas(style.color)
      const bg = viaMap(el, 'background-color') || parse(style.backgroundColor) || viaCanvas(style.backgroundColor)
      if (!fg || !bg) return { missing: true, color: style.color, background: style.backgroundColor, ratio: 0 }
      return { color: style.color, background: style.backgroundColor, fg, bg, ratio: ratio(fg, bg) }
    }
    return {
      success: pick(document.querySelector('.nasq-status-chip-success')),
      warning: pick(document.querySelector('.nasq-status-chip-warning')),
      danger: pick(document.querySelector('.nasq-status-chip-danger')),
      unread: pick(document.querySelector('.nasq-unread-count')),
    }
  })
}

test('desktop 1440 light medium — route smoke and targeted fixes', async ({ page }) => {
  const errors = attachErrorProbe(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await setAppearance(page, 'light', 'medium')
  await login(page)

  const coverage: Record<string, { ok: boolean; shot?: string; defects?: string[] }> = {}
  const batchDefects: string[] = []
  for (const route of ROUTES) {
    const result = await visit(page, route, { checkWidth: true, checkForm: true })
    const file = `${route.id}-desktop.png`
    await page.screenshot({ path: shot(file), fullPage: true })
    const pageErrors = errors.splice(0)
    const defects = [...result.defects, ...pageErrors.map(e => `pageerror ${e}`)]
    coverage[route.id] = { ok: defects.length === 0, shot: file, defects }
    for (const d of defects) batchDefects.push(`${route.id}: ${d}`)
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, 'desktop-routes.json'), JSON.stringify({ coverage, batchDefects }, null, 2))

  await page.goto('/tasks')
  await expect(page.locator('.nasq-status-chip-success')).not.toHaveCount(0)
  await expect(page.locator('.nasq-status-chip-warning')).not.toHaveCount(0)
  await expect(page.locator('.nasq-status-chip-danger')).not.toHaveCount(0)
  await expect(page.getByTestId('notification-count')).not.toHaveCount(0)
  const lightContrast = await measureChipContrast(page)
  for (const [name, sample] of Object.entries(lightContrast)) {
    expect(sample, name).toBeTruthy()
    expect(sample!.ratio, `${name} light contrast ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5)
  }

  await page.goto('/projects/1/settings')
  await expect(page.locator('.nasq-form-section-title')).toHaveCount(3)
  const gap = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.nasq-form-section-title')]
    return titles.map((title) => {
      const section = title.closest('.nasq-form-section')
      const next = title.nextElementSibling as HTMLElement | null
      if (!section || !next) return { title: title.textContent, gap: -1 }
      return {
        title: title.textContent?.trim(),
        gap: next.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
      }
    })
  })
  const staged = gap.filter(item => item.title === 'المراحل' || item.title === 'المتابعون')
  expect(staged.length).toBeGreaterThanOrEqual(2)
  for (const item of staged) expect(item.gap, JSON.stringify(item)).toBeGreaterThanOrEqual(12)

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/settings/projects/catalogs/types/new')
  await assertH1(page, 'نوع مشروع جديد')
  const catalog = page.locator('[data-slot="page-container"][data-layout-width="form"]')
  await expect(catalog).toBeVisible()
  const catalogBox = await catalog.evaluate((el) => {
    const style = getComputedStyle(el)
    return { width: el.getBoundingClientRect().width, maxWidth: style.maxWidth }
  })
  expect(catalogBox.maxWidth).toBe('940px')
  expect(catalogBox.width).toBeLessThanOrEqual(940)
  await page.screenshot({ path: shot('catalog-new-1920.png'), fullPage: true })

  await page.goto('/settings/appearance')
  const settingsForm = page.locator('.nasq-settings-form-page')
  await expect(settingsForm).toBeVisible()
  const settingsBox = await settingsForm.evaluate((el) => {
    const style = getComputedStyle(el)
    return { width: el.getBoundingClientRect().width, maxWidth: style.maxWidth }
  })
  expect(settingsBox.maxWidth).toBe('940px')
  expect(settingsBox.width).toBeLessThanOrEqual(940)
  coverage['catalog-new-1920'] = { ok: true, shot: 'catalog-new-1920.png' }

  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, 'desktop-coverage.json'), JSON.stringify({ coverage, lightContrast, stageFollowerGap: staged, batchDefects }, null, 2))
  expect(batchDefects, batchDefects.join('\n')).toEqual([])
})

test('mobile 390 dark large — smoke', async ({ page }) => {
  const errors = attachErrorProbe(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await setAppearance(page, 'dark', 'large')
  await login(page)

  const coverage: Record<string, { ok: boolean; shot?: string; defects?: string[] }> = {}
  const batchDefects: string[] = []
  for (const route of ROUTES) {
    const result = await visit(page, route, { checkWidth: false, checkForm: false })
    const file = `${route.id}-mobile.png`
    await page.screenshot({ path: shot(file) })
    const pageErrors = errors.splice(0)
    const defects = [...result.defects, ...pageErrors.map(e => `pageerror ${e}`)]
    coverage[route.id] = { ok: defects.length === 0, shot: file, defects }
    for (const d of defects) batchDefects.push(`${route.id}: ${d}`)
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, 'mobile-routes.json'), JSON.stringify({ coverage, batchDefects }, null, 2))

  await page.goto('/tasks')
  await expect(page.locator('.nasq-status-chip-success')).not.toHaveCount(0)
  await expect(page.locator('.nasq-status-chip-warning')).not.toHaveCount(0)
  await expect(page.locator('.nasq-status-chip-danger')).not.toHaveCount(0)
  await expect(page.getByTestId('notification-count')).not.toHaveCount(0)
  const darkContrast = await measureChipContrast(page)
  for (const [name, sample] of Object.entries(darkContrast)) {
    expect(sample, name).toBeTruthy()
    expect(sample!.ratio, `${name} dark contrast ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5)
  }

  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, 'mobile-coverage.json'), JSON.stringify({ coverage, darkContrast, batchDefects }, null, 2))
  expect(batchDefects, batchDefects.join('\n')).toEqual([])
})
