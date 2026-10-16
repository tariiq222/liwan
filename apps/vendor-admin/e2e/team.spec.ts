import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { addVirtualAuthenticator, ageStepUp, completeEnrollment, leaveRecoveryCodes, mintInvitation, mock, openInvitation, resetMock } from './support'

// The team page against the mock control service, through the real forms and the real step-up
// panel (a virtual authenticator answers the passkey prompt). The mock follows the account routes
// of the control plane (accounts-http.ts); the real service is exercised by the live proof.
test.beforeEach(async () => { await resetMock() })

const SHOTS = process.env.SHOTS_DIR ?? '../../.superpowers/wave3-G-shots'
const stepUpPanel = (page: Page) => page.locator('[data-slot="step-up-panel"]')
const rowOf = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email })
const linkInput = (page: Page) => page.getByTestId('invitation-link-value')

/** Signs in as an enrolled owner whose step-up is due, then opens the team page. */
async function ownerOnTeamPage(page: Page, context: BrowserContext): Promise<{ email: string }> {
  await addVirtualAuthenticator(context, page)
  const { token, email } = await mintInvitation(['owner'])
  await openInvitation(page, token)
  await completeEnrollment(page)
  await leaveRecoveryCodes(page)
  await mock('/__mock/config', 'POST', { stepUpRequired: true })
  await ageStepUp()
  await page.goto('/team')
  await expect(page.getByRole('heading', { level: 1, name: 'الفريق' })).toBeVisible()
  await expect(page.getByTestId('team-invite')).toBeVisible()
  return { email }
}

async function inviteThroughForm(page: Page, input: { email: string, name: string, role: string, reason: string }) {
  await page.getByTestId('team-invite').click()
  await page.getByTestId('invite-email').fill(input.email)
  await page.getByTestId('invite-name').fill(input.name)
  await page.getByLabel(input.role).check()
  await page.getByTestId('invite-reason').fill(input.reason)
  await page.getByTestId('invite-submit').click()
}

async function shoot(page: Page, name: string) {
  for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
    await page.setViewportSize(viewport)
    for (const scheme of ['light', 'dark']) {
      await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), scheme)
      // Controls fade between the two color sets; shoot after the fade.
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/${name}-${scheme}-${size}.png`, fullPage: true })
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.setViewportSize({ width: 1440, height: 900 })
}

test('invite: step-up first, the link shown once in the panel, the invitee enrolls and turns active', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const owner = await ownerOnTeamPage(page, context)
  await expect(rowOf(page, 'owner@example.test')).toContainText('نشط')
  await expect(rowOf(page, owner.email)).toContainText('أنت')
  await shoot(page, 'team-ar-list')

  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname) })
  // Hold the options answer so the step-up panel can be seen while the confirmation is open.
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/auth/step-up-options', async (route) => { await held; await route.continue() })
  await inviteThroughForm(page, { email: 'Finance@Example.test', name: 'Fatima', role: 'المالية', reason: 'new finance lead' })
  await expect(stepUpPanel(page)).toBeVisible()
  release()

  // The link appears once, inside the panel, with the secret in the fragment.
  await expect(linkInput(page)).toBeVisible()
  await expect(page).toHaveURL(/\/team\/new$/)
  const link = await linkInput(page).inputValue()
  expect(link).toMatch(/^http:\/\/localhost:\d+\/enroll#[A-Za-z0-9_-]{20,}$/)
  expect(posts.filter(path => path === '/api/vendor/v1/admin/accounts')).toHaveLength(2)
  expect(posts.filter(path => path === '/api/auth/step-up-verify')).toHaveLength(1)
  await shoot(page, 'team-ar-link')

  await page.getByTestId('invitation-link-copy').click()
  await expect(page.getByText('تم النسخ')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)

  // Closing the panel returns to the list; the secret is nowhere in the page, storage or URL.
  await page.getByTestId('invitation-link-dismiss').click()
  await expect(page).toHaveURL(/\/team$/)
  await expect(linkInput(page)).toHaveCount(0)
  const token = link.split('#')[1]!
  expect(await page.evaluate(secret => document.documentElement.outerHTML.includes(secret) || JSON.stringify([localStorage, sessionStorage]).includes(secret) || location.href.includes(secret), token)).toBe(false)
  await expect(rowOf(page, 'finance@example.test')).toContainText('بانتظار قبول الدعوة')
  await expect(rowOf(page, 'finance@example.test')).toContainText('المالية')
  await expect(rowOf(page, 'finance@example.test')).toContainText('لم يدخل بعد')
  await page.goto('/')
  await page.goto('/team')
  await expect(linkInput(page)).toHaveCount(0)

  // The invited person opens the link in their own browser and enrolls.
  const invitee = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'ar-SA' })
  const inviteePage = await invitee.newPage()
  await addVirtualAuthenticator(invitee, inviteePage)
  await inviteePage.goto(link)
  await expect(inviteePage.locator('#device-label')).toBeVisible()
  await completeEnrollment(inviteePage)
  await leaveRecoveryCodes(inviteePage)
  await invitee.close()

  await page.reload()
  await expect(rowOf(page, 'finance@example.test')).toContainText('نشط')
  await expect(rowOf(page, 'finance@example.test')).not.toContainText('لم يدخل بعد')
})

test('invite panel: a direct link and a refresh open it over the list, a draft asks before it is lost', async ({ page, context }) => {
  await ownerOnTeamPage(page, context)
  await page.goto('/team/new')
  const panel = page.getByRole('dialog', { name: 'دعوة شخص جديد' })
  await expect(panel).toBeVisible()
  await page.reload()
  await expect(panel).toBeVisible()
  await expect(page.locator('main')).toContainText('الفريق')
  await expect(page.getByTestId('shell-main')).toBeAttached()

  // Nothing typed: closing leaves at once. A draft asks first, and Stay keeps it.
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await expect(page).toHaveURL(/\/team$/)
  await page.getByTestId('team-invite').click()
  await page.getByTestId('invite-email').fill('draft@example.test')
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(page.getByTestId('invite-email')).toHaveValue('draft@example.test')
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await page.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(/\/team$/)
})

test('invite: validation blocks an empty form, a duplicate email is refused in words', async ({ page, context }) => {
  await ownerOnTeamPage(page, context)
  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname) })
  await page.getByTestId('team-invite').click()
  await page.getByTestId('invite-submit').click()
  await expect(page.getByText('اكتب بريدًا إلكترونيًا صحيحًا.')).toBeVisible()
  await expect(page.getByText('اكتب الاسم.')).toBeVisible()
  await expect(page.getByText('اختر دورًا واحدًا على الأقل.').first()).toBeVisible()
  await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  expect(posts).toEqual([])
  await shoot(page, 'team-ar-form-errors')

  await page.getByTestId('invite-email').fill('owner@example.test')
  await page.getByTestId('invite-name').fill('Again')
  await page.getByLabel('الدعم').check()
  await page.getByTestId('invite-reason').fill('duplicate')
  await page.getByTestId('invite-submit').click()
  await expect(page.getByTestId('team-error')).toContainText('يوجد حساب بهذا البريد الإلكتروني')
  await expect(page.getByTestId('invitation-link-value')).toHaveCount(0)
})

test('roles: change the roles of a person with a reason', async ({ page, context }) => {
  await ownerOnTeamPage(page, context)
  const row = rowOf(page, 'owner@example.test')
  await row.getByTestId('team-roles').click()
  await expect(page.getByRole('group', { name: 'الأدوار' })).toBeVisible()
  await page.getByLabel('المنتج').check()
  await page.getByTestId('action-submit').click()
  await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  await page.getByTestId('action-reason').fill('also owns the catalog')
  await page.getByTestId('action-submit').click()
  await expect(stepUpPanel(page)).toHaveCount(0)
  await expect(page.getByTestId('team-notice')).toContainText('تم حفظ أدوار')
  await expect(row.getByTestId('team-role-badges')).toContainText('المالك')
  await expect(row.getByTestId('team-role-badges')).toContainText('المنتج')
})

test('disable and re-enroll: inline confirmation, a new link, and the last owner is protected', async ({ page, context }) => {
  const owner = await ownerOnTeamPage(page, context)
  const seeded = rowOf(page, 'owner@example.test')

  // Re-enrolling the seeded owner shows a new link (secret, once).
  await seeded.getByTestId('team-reset').click()
  await expect(page.getByTestId('inline-confirm')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByText('اكتب سببًا من 3 أحرف على الأقل.')).toBeVisible()
  await page.getByTestId('action-reason').fill('lost laptop')
  await page.getByTestId('inline-confirm-action').click()
  await expect(linkInput(page)).toHaveValue(/\/enroll#[A-Za-z0-9_-]{20,}$/)
  await page.getByTestId('invitation-link-dismiss').click()

  // Disabling asks inline, with Cancel first; confirming disables the account.
  await seeded.getByTestId('team-disable').click()
  await expect(page.getByTestId('inline-confirm')).toContainText('تعطيل حساب Owner؟')
  await shoot(page, 'team-ar-confirm')
  await page.getByTestId('inline-confirm-cancel').click()
  await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
  await seeded.getByTestId('team-disable').click()
  await page.getByTestId('action-reason').fill('left the company')
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('team-notice')).toContainText('تم تعطيل حساب Owner')
  await expect(seeded).toContainText('معطّل')
  await expect(seeded.getByTestId('team-disable')).toHaveCount(0)

  // Only the signed-in owner is left: neither disabling nor demoting that account is allowed.
  const me = rowOf(page, owner.email)
  await expect(me).toContainText('أنت')
  await expect(me.getByTestId('team-disable')).toHaveCount(0)
  await expect(me.getByTestId('team-reset')).toHaveCount(0)
  await expect(me).toContainText('لا يمكنك تعطيل حسابك')
  await me.getByTestId('team-roles').click()
  await page.getByLabel('المالك').uncheck()
  await page.getByLabel('الدعم').check()
  await page.getByTestId('action-reason').fill('step down')
  await page.getByTestId('action-submit').click()
  await expect(page.getByTestId('team-error')).toContainText('يلزم مالك نشط واحد على الأقل')
  await shoot(page, 'team-ar-last-owner')
  await expect(me).toContainText('المالك')

  // Keeping the owner role is allowed even for the only owner.
  await page.getByLabel('المالك').check()
  await page.getByTestId('action-submit').click()
  await expect(page.getByTestId('team-notice')).toContainText('تم حفظ أدوار')
})

test('english interface reads left to right', async ({ page, context }) => {
  await ownerOnTeamPage(page, context)
  await context.addCookies([{ name: 'webvue-admin-locale', value: 'en', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await page.getByTestId('team-invite').click()
  await expect(page.getByRole('group', { name: 'Roles' })).toBeVisible()
  await shoot(page, 'team-en-form')
})

test('invite panel: a failed step-up keeps Retry reachable over the open panel, and Retry finishes the invitation', async ({ page, context }) => {
  await ownerOnTeamPage(page, context)
  await mock('/__mock/config', 'POST', { stepUpVerifyFails: true })
  await inviteThroughForm(page, { email: 'retry@example.test', name: 'Retry', role: 'الدعم', reason: 'second try' })
  await expect(stepUpPanel(page).getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible()
  await mock('/__mock/config', 'POST', { stepUpVerifyFails: false })
  await stepUpPanel(page).getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(linkInput(page)).toBeVisible()
})
