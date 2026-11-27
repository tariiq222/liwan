import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sharedTenantLoginUrl, type SharedTenantProgress } from '../../composables/useSharedTenantOnboarding'

const webRoot = resolve(import.meta.dirname, '../../..')
const form = readFileSync(resolve(webRoot, 'app/pages/customers/new.vue'), 'utf8')
const detail = ['app/components/vendor/WorkspacePanel.vue', 'app/composables/useWorkspaceProvisioning.ts'].map(file => readFileSync(resolve(webRoot, file), 'utf8')).join('\n')
const ready: SharedTenantProgress = { tenant_id: 'tenant', job_id: 'job', status: 'active', host: 'tenant.liwan.test', admin_login: 'admin@example.test', stage: 'active', error_code: null }

describe('shared tenant onboarding browser contract', () => {
  it('creates a shared tenant from a plan (customer, quote, order) and retains dedicated registration', () => {
    expect(form).toContain('sharedOnboardingEnabled: sharedEnabled')
    expect(form).toContain('sharedEnabled.value ? Promise.resolve({ items: [], total: 0 })')
    // Shared onboarding picks a plan, not a catalog version, so it does not read the versions at all.
    expect(form).toContain('useVendorCatalogVersions().load(!sharedEnabled.value)')
    for (const field of ['mode', 'hosting', 'target']) expect(form).toContain(`<UFormField :label="t('vendor.tenants.fields.${field}')"`)
    // Identity fields lock once the customer exists so a retry never diverges from it.
    expect((form.match(/:disabled="Boolean\(createdCustomer\)"/g) ?? []).length).toBe(3)
    expect(form).toContain('subscriptions.createCustomer(planTenantCustomerBody(form, creationRequestId.value))')
    expect(form).toContain('planTenantQuoteBody(createdCustomer.value, selectedPlan.value, selectedCadence.value)')
    expect(form).toContain('subscriptions.placeOrder(')
    // A4: a vendor-added customer never starts a trial, so no trial path exists here at all.
    expect(form).not.toContain('subscriptions.startTrial')
    expect(form).not.toContain('plan-trial')
    expect(form).toContain("const startablePlans = computed(() => (plans.value ?? []).filter(p => p.trial_days === 0 && p.audience.kind === 'public'))")
    // Every offered plan places its first order, free or paid, and the onboarding is an optional extra on it.
    expect(form).toContain('await subscriptions.placeOrder({')
    expect(form).toContain('data-testid="onboarding-choice"')
    expect(form).toContain('admin_login')
    expect(form).toContain('startablePlans.map(p => ({ label: p.name, value: p.id }))')
    expect(form).toContain("request<{ id: string }>('tenants'")
    expect(form).toContain('<SharedUnsavedChanges :dirty="dirty"')
    expect(form).toContain("can('vendor.tenants.manage')")
    expect(form).toContain("can('vendor.subscriptions.manage')")
  })

  it('reuses the created customer when a later step fails, so a retry creates no duplicate', () => {
    expect(form).toContain('createdCustomer.value ??= (await subscriptions.createCustomer(planTenantCustomerBody(form, creationRequestId.value))).id')
    // A lost create response is retried with the same server-side request id.
    expect(form).toContain('creationRequestId.value ??= crypto.randomUUID()')
  })

  it('stops the form before any write when the catalog has no release, so no empty customer is left behind', () => {
    expect(form).toContain("commercial.releases()")
    expect(form).toContain('const noRelease = computed(() => sharedEnabled.value && releases.value !== null && releases.value !== undefined && releases.value.length === 0)')
    expect(form).toContain(`<UAlert v-if="noRelease" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('vendor.customers.newPage.noRelease')" :description="t('vendor.customers.newPage.noReleaseHint')" />`)
    expect(form).toContain(':disabled="!hydrated || busy || noRelease ||')
    for (const locale of ['ar', 'en']) {
      const strings = JSON.parse(readFileSync(resolve(webRoot, `i18n/locales/${locale}/vendor.json`), 'utf8')).vendor.customers.newPage
      expect(strings.noRelease).toBeTruthy()
      expect(strings.noReleaseHint).toBeTruthy()
    }
  })

  it('does not publish a customer link for failed, stale, or partially activated progress', () => {
    expect(sharedTenantLoginUrl(ready)).toBe('https://tenant.liwan.test/login')
    expect(sharedTenantLoginUrl(null)).toBeNull()
    expect(sharedTenantLoginUrl({ ...ready, error_code: 'verification_failed' })).toBeNull()
    for (const status of ['registered', 'provisioning', 'needs_intervention', 'failed', 'ready']) expect(sharedTenantLoginUrl({ ...ready, status })).toBeNull()
    for (const stage of ['activating', 'verifying', 'needs_intervention', null]) expect(sharedTenantLoginUrl({ ...ready, stage })).toBeNull()
    for (const host of ['https://tenant.test', 'tenant.test/private', 'user@tenant.test', 'javascript:alert(1)', 'tenant..test']) expect(sharedTenantLoginUrl({ ...ready, host })).toBeNull()
  })

  it('localizes failure and unknown stages without displaying raw errors or private values', () => {
    expect(detail).toContain("vendor.tenants.provisioning.failed")
    expect(detail).toContain("vendor.tenants.provisioning.unavailable")
    expect(detail).toContain("? current : 'pending'")
    expect(detail).not.toContain('{{ provisioning.error_code }}')
    expect(detail).toContain('disposed = true')
    for (const lang of ['ar', 'en']) {
      const locale = JSON.parse(readFileSync(resolve(webRoot, `i18n/locales/${lang}/vendor.json`), 'utf8')).vendor.tenants.provisioning
      expect(locale.failed).toBeTruthy()
      expect(locale.stages.pending).toBeTruthy()
    }
  })
})
