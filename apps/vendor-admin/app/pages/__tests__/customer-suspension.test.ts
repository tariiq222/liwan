import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMERCIAL_ERROR_CODES } from '../../utils/vendorCommercial'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = read('app/pages/customers/[id].vue')
const composable = read('app/composables/useVendorSubscriptions.ts')
const locale = (name: 'ar' | 'en') => JSON.parse(read(`i18n/locales/${name}/vendor.json`)).vendor

describe('vendor suspend and resume on the customer page', () => {
  it('offers suspend only for a running subscription and resume only for a suspended one, to a subscriptions manager', () => {
    expect(page).toContain("const canSuspend = computed(() => can('vendor.subscriptions.manage') && !error.value && ['active', 'past_due', 'trialing'].includes(view.value?.state ?? ''))")
    expect(page).toContain("const canResume = computed(() => can('vendor.subscriptions.manage') && !error.value && view.value?.state === 'suspended')")
  })
  it('confirms inline with a reason of three characters or more, never in a dialog', () => {
    expect(page).toContain('<SharedInlineConfirm v-if="suspensionAction"')
    expect(page).toContain('suspensionReason.value.trim().length >= 3 && suspensionReason.value.trim().length <= 1000')
    expect(page).toContain(':disabled="!hydrated || suspensionBusy || !validSuspensionReason"')
    expect(page).not.toContain('<UModal')
    expect(page).toContain("Boolean(suspensionReason.trim())")
  })
  it('calls the suspend and resume endpoints and reloads the subscription after', () => {
    expect(composable).toContain('`commercial/subscriptions/${seg(id)}/suspend`')
    expect(composable).toContain('`commercial/subscriptions/${seg(id)}/resume`')
    expect(page).toContain('await api.suspendSubscription(view.value.id, suspensionReason.value)')
    expect(page).toContain('await api.resumeSubscription(view.value.id, suspensionReason.value)')
    expect(page).toContain('closeSuspension()\n    await refreshCancellationState()')
  })
  it('explains the refusals and the actions in both languages', () => {
    for (const code of ['subscription_not_suspendable', 'subscription_not_suspended']) expect(COMMERCIAL_ERROR_CODES).toContain(code)
    for (const name of ['ar', 'en'] as const) {
      const strings = locale(name)
      for (const key of ['suspend', 'resume', 'suspendTitle', 'suspendHint', 'resumeTitle', 'resumeHint', 'reason', 'suspendedNotice']) expect(strings.customers.suspension[key], `${name}.${key}`).toBeTruthy()
      for (const code of ['subscription_not_suspendable', 'subscription_not_suspended']) expect(strings.pricing.errors[code], `${name}.${code}`).toBeTruthy()
    }
  })
})
