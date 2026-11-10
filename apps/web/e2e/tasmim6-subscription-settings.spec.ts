import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { orderSchema, trialEndPreviewSchema, type SubscriptionView } from '@liwan/commercial-contracts'
import { expectNoSecondH1, fitsWidth, login, mobileRows, open, rows } from './tasmim6-commercial-helpers'
test.beforeEach(async ({ page }) => { await login(page) })

test('subscription settings keep plan usage branches invoices and explicit auto renew consent', async ({ page }) => {
 await open(page,'/subscription'); await expectNoSecondH1(page)
 await expect(page.locator('[data-slot="record-section"]')).toHaveCount(7)
 await expect(page.getByTestId('usage-metric')).toHaveCount(2); await expect(page.getByTestId('usage-metric').filter({has:page.locator('[data-known="false"]')})).toHaveCount(0)
 await expect(page.locator('[data-testid="usage-metric"][data-known="false"]')).toHaveCount(1)
 await expect(page.getByTestId('branch-row')).toHaveCount(1); await expect(page.locator('a[href^="/subscription/invoices/inv-"]')).toHaveCount(2)
 const control=page.locator('[data-slot="auto-renew"]'); await expect(control.getByRole('button')).toBeDisabled()
 await control.getByRole('checkbox').check(); await expect(control.getByRole('button')).toBeEnabled()
})
test('an order that is no longer pending shows its note and never posts an order', async ({ page }) => {
 const orders:string[]=[]; page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/commercial/v1/orders'))orders.push(r.url())})
 await open(page,'/subscription/status?order=order-x'); await expect(page.getByRole('main')).toContainText('هذا الطلب لم يعد معلّقًا.'); expect(orders).toEqual([])
})
test('branches are read only without branches.manage', async ({ page }) => {
 await open(page,'/subscription'); let intercepted=0
 await page.route('**/api/v1/me',async route=>{const response=await route.fetch();const value=await response.json();intercepted++;await route.fulfill({json:{...value,capabilities:['access.users.read']}})})
 await page.getByTestId('context-link-subscription-branches').click(); await expect.poll(()=>intercepted).toBeGreaterThan(0)
 await expect(page.getByRole('link',{name:'إضافة فرع'})).toHaveCount(0)
})
test('the new branch opens a closeable create panel and subscription pages fit the phone', async ({ page }) => {
 await open(page,'/subscription/branches/new'); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog')).toBeVisible()
 await page.getByRole('button',{name:'إغلاق',exact:true}).click(); await expect(page.getByRole('dialog')).toHaveCount(0)
 await page.setViewportSize({width:390,height:844})
 for(const path of ['/subscription','/subscription/status?order=order-x','/subscription/branches','/subscription/change','/subscription/branches/new']) {await open(page,path);expect(await fitsWidth(page)).toBe(true)}
})


test('a pending trial lock offers retry and refreshes the applied outcome', async ({ page }) => {
  await open(page, '/subscription/branches')
  const fixtures = JSON.parse(readFileSync(new URL('./commercial-fixtures.json', import.meta.url), 'utf8')) as { subscription: SubscriptionView }
  const cutoff = '2026-12-01T21:00:00Z'
  let preview = trialEndPreviewSchema.parse({
    status: 'lock_pending',
    trial_ends_at: cutoff,
    outcome: null,
    kept: { bundle_revision_ids: [], paid_users: 0, paid_storage_gb: 0, paid_extra_branches: 0 },
    locked_bundle_revision_ids: [],
    limits: { users: 5, storage_mb: 20_480, extra_branches: 1 },
    excess: { users: null, storage_bytes: null, extra_branches: 1, sampled_at: null, source: 'unavailable', item_details: 'unavailable' },
    first_invoice: null,
    next_attempt_at: '2026-12-01T21:05:00Z',
  })
  let retries = 0
  await page.route('**/api/commercial/v1/subscription', route => route.fulfill({ json: {
    ...fixtures.subscription, trial_ends_at: cutoff, trial_outcome: preview.outcome,
  } }))
  await page.route('**/api/commercial/v1/trial/end-preview', route => route.fulfill({ json: preview }))
  await page.route('**/api/commercial/v1/trial/retry', route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({})
    retries += 1
    preview = { ...preview, status: 'settled', outcome: 'free_base', next_attempt_at: null }
    return route.fulfill({ json: preview })
  })
  await page.getByTestId('context-link-subscription').click()
  const panel = page.getByTestId('trial-end-panel')
  await expect(panel.getByTestId('trial-end-status')).toContainText('جارٍ تطبيق الاشتراك')
  await expect(panel).toContainText('قياسات المستخدمين والتخزين الحالية غير متاحة.')
  await expect(page.getByRole('main').getByRole('link', { name: 'تغيير الاشتراك' })).toHaveCount(0)
  await panel.getByTestId('trial-retry').click()
  await expect(panel.getByTestId('trial-end-status')).toContainText('اكتمل الانتقال بعد التجربة')
  await expect(panel.getByTestId('trial-retry')).toHaveCount(0)
  expect(retries).toBe(1)
})


test('a paid order in automatic recovery polls for its updated status', async ({ page }) => {
  await open(page, '/subscription/branches')
  const { subscription } = JSON.parse(readFileSync(new URL('./commercial-fixtures.json', import.meta.url), 'utf8')) as { subscription: SubscriptionView }
  const paidOrder = orderSchema.parse({
    id: 'order-recovering', customer_id: subscription.customer_id, subscription_id: subscription.id,
    kind: 'change', quote_id: 'quote-recovering', target_revision_id: subscription.applied?.id,
    expected_applied_revision_id: subscription.applied?.id ?? null,
    payment_state: 'paid', fulfillment_state: 'needs_intervention',
    effective_at: null, idempotency_key: 'recovery-fixture', request_digest: 'recovery-fixture',
    due_now: { currency: 'SAR', exponent: 2, minor: 1000 }, created_at: '2026-12-01T21:00:00Z',
  })
  let allowRefundResponse = false
  let updates = 0
  await page.route('**/api/commercial/v1/subscription', route => {
    if (allowRefundResponse) updates += 1
    return route.fulfill({ json: { ...subscription, pending_order: allowRefundResponse ? { ...paidOrder, payment_state: 'refund_pending' } : paidOrder } })
  })
  await page.getByTestId('context-link-subscription-status').click()
  const outcome = page.getByTestId('order-outcome')
  await expect(outcome).toHaveAttribute('data-outcome', 'recovering')
  await expect(outcome).toContainText('جارٍ معالجة الطلب تلقائيًا')
  allowRefundResponse = true
  await expect(outcome).toHaveAttribute('data-outcome', 'refund', { timeout: 10_000 })
  expect(updates).toBeGreaterThan(0)
})
