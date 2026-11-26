import { expect, test } from '@playwright/test'

// The design audit's three staff screens. They need capabilities the default mock identity does not carry, so this
// spec opts in with `mock_caps=ops_desk` (see e2e/mock-capabilities.mjs) instead of widening the default set, which
// would move every navigation and permission spec. The lists answer with an empty envelope, so what is captured here
// is the page's real empty state, never a refusal.
const ROUTES = [
  { path: '/operations', heading: 'العمليات' },
  { path: '/helpdesk', heading: 'الدعم الفني' },
  { path: '/appointments', heading: 'المواعيد' },
]

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'mock_caps', value: 'ops_desk', domain: 'localhost', path: '/' }])
})

for (const route of ROUTES) {
  test(`${route.path} renders the staff surface, not a refusal`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(`page: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
    const response = await page.goto(route.path)
    expect(response?.status(), `${route.path} must not be refused`).toBe(200)
    await expect(page.locator('h1')).toContainText(route.heading)
    await expect(page.getByText('ليس لديك صلاحية')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
