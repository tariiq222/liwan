import { expect, test, type Page } from '@playwright/test'
import { completeEnrollment, leaveRecoveryCodes, mintInvitation, openInvitation, resetMock, addVirtualAuthenticator } from './support'

// The platform AI page against the mock control service (e2e/ai-provider-mock.mjs): the configuration is shown, the save-then-test order
// is visible in the controls, and a save round-trips. Screenshots (Arabic right to left and English, at 1280 and 390 px) go to SHOTS_DIR.
test.beforeEach(async () => { await resetMock() })

const SHOTS = process.env.SHOTS_DIR ?? '../../.superpowers/ai-provider-shots'
const SIZES = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } }

async function ownerOnAiPage(page: Page, context: Parameters<typeof addVirtualAuthenticator>[0], locale: 'ar' | 'en') {
  await addVirtualAuthenticator(context, page)
  const { token } = await mintInvitation(['owner'])
  await openInvitation(page, token)
  await completeEnrollment(page)
  await leaveRecoveryCodes(page)
  await context.addCookies([{ name: 'liwan-admin-locale', value: locale, url: page.url() }])
  await page.goto('/ai-provider')
  await expect(page.getByTestId('ai-provider-delivery')).toBeVisible()
}

/** Each width gets a fresh load: the shell chooses its layout from the width at load time. */
async function atWidth(page: Page, size: { width: number, height: number }) {
  await page.setViewportSize(size)
  await page.reload()
  await expect(page.getByTestId('ai-provider-delivery')).toBeVisible()
}

for (const locale of ['ar', 'en'] as const) {
  test(`shows the configuration (${locale})`, async ({ page, context }) => {
    await ownerOnAiPage(page, context, locale)
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
    await expect(page.getByTestId('ai-provider-row')).toHaveCount(2)
    await expect(page.getByTestId('ai-model-name')).toHaveCount(3)
    await expect(page.getByTestId('ai-provider-default')).toBeVisible()
    for (const [name, size] of Object.entries(SIZES)) {
      await atWidth(page, size)
      await page.screenshot({ path: `${SHOTS}/ai-provider-${locale}-${name}.png`, fullPage: true })
      // The page never scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })
}

test('a provider that is not saved cannot list or test yet, and a save round-trips', async ({ page, context }) => {
  await ownerOnAiPage(page, context, 'ar')
  const preset = page.getByTestId('ai-provider-preset')
  await preset.click()
  await page.getByRole('option', { name: 'DeepSeek' }).click()
  await page.getByTestId('ai-provider-add').click()
  await expect(page.getByTestId('ai-provider-row')).toHaveCount(3)
  await expect(page.getByTestId('ai-provider-save-first')).toHaveCount(1)
  await page.getByTestId('ai-provider-margin').fill('25')
  await page.getByTestId('ai-provider-key').last().fill('sk-e2e-secret-0123456789')
  await page.getByTestId('ai-provider-save').click()
  await page.getByTestId('ai-provider-reason').fill('Add a provider')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByTestId('ai-provider-notice')).toBeVisible()
  for (const key of await page.getByTestId('ai-provider-key').all()) await expect(key).toHaveValue('')
  await expect(page.getByTestId('ai-provider-save-first')).toHaveCount(0)
})
