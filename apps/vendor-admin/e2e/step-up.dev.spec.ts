import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { addVirtualAuthenticator, ageStepUp, completeEnrollment, leaveRecoveryCodes, mintInvitation, mock, openInvitation, resetMock } from './support'

// Runs against `nuxt dev` (E2E_TARGET=dev): the page imports the app's own useAdminApi, because no
// page with a mutating call exists in this slice. The team page spec (Task 8) repeats the journey
// through the real form.
test.beforeEach(async () => { await resetMock() })

const SHOTS = process.env.SHOTS_DIR ?? '../../.superpowers/wave2-D-shots'
const panel = (page: Page) => page.locator('[data-slot="step-up-panel"]')

async function signedInWithStepUpDue(page: Page, context: BrowserContext) {
  const authenticator = await addVirtualAuthenticator(context, page)
  const { token } = await mintInvitation(['owner'])
  await openInvitation(page, token)
  await completeEnrollment(page)
  await leaveRecoveryCodes(page)
  await mock('/__mock/config', 'POST', { stepUpRequired: true })
  await ageStepUp()
  return authenticator
}

/** The app's request helper, exactly as a page uses it; settles with 'ok' or the error's name. */
function callApi(page: Page) {
  return page.evaluate(async () => {
    const root = document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $nuxt: { runWithContext: <T>(fn: () => T) => T } } } } }
    const { useAdminApi } = await import('/_nuxt/composables/useAdminApi.ts')
    try {
      await root.__vue_app__.config.globalProperties.$nuxt.runWithContext(() => useAdminApi().request('/admin/accounts', { method: 'POST', body: { email: 'new@example.test', display_name: 'New', roles: ['support'], reason: 'step-up check' } }))
      return 'ok'
    } catch (error) {
      return (error as Error).name
    }
  })
}

function watchPosts(page: Page) {
  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname) })
  return posts
}

test('shows the inline panel, asks for the passkey and repeats the call exactly once', async ({ page, context }) => {
  await signedInWithStepUpDue(page, context)
  const posts = watchPosts(page)
  // Hold the options answer so the panel can be seen while the confirmation is open.
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/auth/step-up-options', async (route) => { await held; await route.continue() })
  const outcome = callApi(page)
  await expect(panel(page)).toBeVisible()
  await expect(panel(page)).toContainText('أكّد بمفتاح المرور')
  await expect(panel(page).getByRole('button', { name: 'إلغاء' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: `${SHOTS}/step-up-ar-dark-desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${SHOTS}/step-up-ar-dark-mobile.png` })
  release()
  expect(await outcome).toBe('ok')
  await expect(panel(page)).toHaveCount(0)
  expect(posts.filter(path => path === '/api/vendor/v1/admin/accounts')).toHaveLength(2)
  expect(posts.filter(path => path === '/api/auth/step-up-options')).toHaveLength(1)
  expect(posts.filter(path => path === '/api/auth/step-up-verify')).toHaveLength(1)
})

test('a failed confirmation leaves the panel with Retry; Retry then repeats the call once', async ({ page, context }) => {
  await signedInWithStepUpDue(page, context)
  await mock('/__mock/config', 'POST', { stepUpVerifyFails: true })
  const posts = watchPosts(page)
  const outcome = callApi(page)
  await expect(panel(page).getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible()
  await expect(panel(page)).toContainText('تعذّر تسجيل الدخول')
  await mock('/__mock/config', 'POST', { stepUpVerifyFails: false })
  await panel(page).getByRole('button', { name: 'إعادة المحاولة' }).click()
  expect(await outcome).toBe('ok')
  expect(posts.filter(path => path === '/api/vendor/v1/admin/accounts')).toHaveLength(2)
})

test('cancelling while the passkey prompt is open rejects the call and never repeats it', async ({ page, context }) => {
  const authenticator = await signedInWithStepUpDue(page, context)
  await authenticator.remove()
  const posts = watchPosts(page)
  const outcome = callApi(page)
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('button', { name: 'إلغاء' }).click()
  expect(await outcome).toBe('StepUpCancelled')
  await expect(panel(page)).toHaveCount(0)
  expect(posts.filter(path => path === '/api/vendor/v1/admin/accounts')).toHaveLength(1)
})
