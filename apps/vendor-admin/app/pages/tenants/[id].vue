<script setup lang="ts">
import { operationStatusBadge } from '@/utils/vendorBadges'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
import { sharedTenantLoginUrl, type SharedTenantProgress } from '@/composables/useSharedTenantOnboarding'
import { buildVendorPolicy, type VendorFeatureValue } from '@/utils/vendorPolicy'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'
definePageMeta({ capability: 'vendor.read' })
type Tenant = { id: string; name: string; commercial_mode: string; hosting_model: string; inventory_target: string; catalog_version: string | null; catalog_tier: string | null; status: string; desired_policy: Record<string, any> | null; observed_policy: Record<string, any> | null; policy_revision: number | null; health_checked_at: string | null; operations_enabled: boolean; available_operations?: unknown; created_at: string }
type TenantOperation = 'tenant.create' | 'tenant.inspect' | 'health' | 'backup' | 'tenant.entitle'
const tenantOperationTypes = new Set<TenantOperation>(['tenant.create', 'tenant.inspect', 'health', 'backup', 'tenant.entitle'])
type Catalog = { version: string; status: string; solution: { tiers?: { id: string; name: string; features?: string[]; limits?: Record<string, number> }[] } }
const { t, locale } = useI18n()
const route = useRoute()
const { request } = useVendorApi()
const vendorContext = useVendorContext()
const { can } = vendorContext
const id = computed(() => String(route.params.id))
const { data: commercialCustomer } = await useAsyncData(() => `vendor:tenant-customer:${id.value}`, async () => {
  try { const page = await useVendorSubscriptions().listCustomers({ tenant_id: id.value, limit: 1 }); return page.items.find(c => c.tenant_id === id.value) ?? null } catch { return null }
})
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/tenants', ['/tenants']))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:tenant:${id.value}`, () => request<Tenant>(`tenants/${encodeURIComponent(id.value)}`))
const { data: catalog } = await useAsyncData('vendor:catalog-features', () => request<{ items: Catalog[]; total: number }>('catalog'))
const hydrated = useHydrated()
const { data: provisioning, error: provisioningError, pending: provisioningPending, refresh: refreshProvisioning } = await useAsyncData(
  () => `vendor:tenant-provisioning:${id.value}`,
  async () => {
    if (!vendorContext.sharedOnboardingEnabled.value) return null
    try { return await request<SharedTenantProgress>(`shared/tenants/${encodeURIComponent(id.value)}/provisioning`) }
    catch (cause) {
      const error = cause as { statusCode?: number; status?: number; response?: { status?: number } }
      if ((error.statusCode ?? error.status ?? error.response?.status) === 404) return null
      throw cause
    }
  },
)
const loginUrl = computed(() => provisioningError.value ? null : sharedTenantLoginUrl(provisioning.value))
const provisioningFailed = computed(() => ['failed', 'needs_intervention'].includes(provisioning.value?.status ?? '') || Boolean(provisioning.value?.error_code))
const provisioningActive = computed(() => Boolean(provisioning.value && !loginUrl.value && !provisioningFailed.value))
const provisioningStage = computed(() => {
  const stage = provisioning.value?.stage
  return stage && ['reserved', 'queued', 'verifying', 'activating', 'active', 'needs_intervention'].includes(stage) ? stage : 'pending'
})
const provisioningPollCount = ref(0)
const provisioningPollingPaused = computed(() => provisioningActive.value && provisioningPollCount.value >= 60)
let provisioningTimer: ReturnType<typeof setTimeout> | undefined
let provisioningDisposed = false
function stopProvisioningPoll() { if (provisioningTimer) clearTimeout(provisioningTimer); provisioningTimer = undefined }
function scheduleProvisioningPoll() {
  stopProvisioningPoll()
  if (!import.meta.client || provisioningDisposed || !provisioningActive.value || provisioningError.value || provisioningPollCount.value >= 60) return
  provisioningTimer = setTimeout(async () => {
    provisioningPollCount.value++
    await refreshProvisioning()
    scheduleProvisioningPoll()
  }, 5000)
}
async function refreshSharedProvisioning() {
  provisioningPollCount.value = 0
  await refreshProvisioning()
  scheduleProvisioningPoll()
}
watch(id, () => { provisioningPollCount.value = 0; stopProvisioningPoll() })
watch([provisioningActive, provisioningError], scheduleProvisioningPoll)
onMounted(scheduleProvisioningPoll)
onBeforeUnmount(() => { provisioningDisposed = true; stopProvisioningPoll() })
const publishedCatalog = computed(() => catalog.value?.items.find(item => item.status === 'published' && item.version === data.value?.catalog_version))
const selectedTier = computed(() => publishedCatalog.value?.solution.tiers?.find(item => item.id === data.value?.catalog_tier))
const featureKeys = computed(() => {
  const result = new Map<string, 'boolean' | 'limit'>([['users.limit', 'limit'], ['storage.limit_mb', 'limit']])
  for (const name of selectedTier.value?.features ?? []) {
    const match = /^(boolean|limit):(.+)$/.exec(name)
    if (match) result.set(match[2]!, match[1] as 'boolean' | 'limit')
  }
  for (const key of Object.keys(selectedTier.value?.limits ?? {})) result.set(key, 'limit')
  return [...result]
})
const currentFeatures = computed<Record<string, unknown>>(() => data.value?.observed_policy ?? data.value?.desired_policy ?? {})
const expectedRevision = computed(() => data.value?.policy_revision ?? null)
const availableOperations = computed<TenantOperation[]>(() => {
  const operations = data.value?.available_operations
  if (!Array.isArray(operations) || !operations.every((operation): operation is TenantOperation => typeof operation === 'string' && tenantOperationTypes.has(operation as TenantOperation))) return []
  return [...new Set(operations)]
})
const canVendor = vendorContext.can
const grantReason = ref('')
const grantError = ref<unknown>(null)
const grantBusy = ref(false)
const confirmRevoke = ref(false)
const actionType = ref<TenantOperation>('tenant.inspect')
const reason = ref('')
const actionError = ref<unknown>(null)
const actionBusy = ref(false)
const edits = reactive<Record<string, boolean | number | string>>({})
const submitted = ref(false)
const dirty = computed(() => !submitted.value && Boolean(reason.value.trim() || grantReason.value.trim() || (actionType.value === 'tenant.entitle' && featureKeys.value.some(([key, kind]) => {
  const current = currentFeatures.value[key]
  return edits[key] !== (kind === 'boolean' ? current === true : typeof current === 'number' ? String(current) : '')
}))))
function policyValue(value: unknown): string {
  if (value === null) return t('vendor.common.unlimited')
  if (typeof value === 'boolean') return t(value ? 'vendor.common.enabled' : 'vendor.common.disabled')
  return String(value)
}
watch([data, selectedTier, availableOperations], () => {
  submitted.value = false
  if (!availableOperations.value.includes(actionType.value)) actionType.value = availableOperations.value[0] ?? 'tenant.inspect'
  for (const [key, kind] of featureKeys.value) {
    const current = currentFeatures.value[key]
    edits[key] = kind === 'boolean' ? current === true : typeof current === 'number' ? String(current) : ''
  }
}, { immediate: true })

function fieldErrorKey(cause: unknown): string {
  const value = cause as { data?: { data?: { field?: unknown }; field?: unknown }; field?: unknown } | null
  const field = value?.data?.data?.field ?? value?.data?.field ?? value?.field
  return typeof field === 'string' ? `vendor.errors.field.${field}` : 'vendor.errors.action'
}

async function updateGrant(enabled: boolean) {
  if (!data.value || !canVendor('vendor.tenants.manage') || grantBusy.value || !grantReason.value.trim()) return
  grantBusy.value = true
  grantError.value = null
  data.value = { ...data.value, available_operations: undefined }
  try {
    await request<Tenant>(`tenants/${encodeURIComponent(id.value)}/operations-grant`, { method: 'POST', body: { enabled, reason: grantReason.value } })
    await refresh()
    grantReason.value = ''
    confirmRevoke.value = false
  } catch (cause) {
    grantError.value = cause
    // The request may have committed before a response failed; recover server truth.
    await refresh().catch(() => {})
  } finally { grantBusy.value = false }
}

async function enqueueOperation() {
  if (!data.value || !data.value.operations_enabled || !canVendor('vendor.operations.run') || actionBusy.value || !reason.value.trim()) return
  if (!operationTypes.value.some(operation => operation.value === actionType.value)) return
  if (actionType.value === 'tenant.entitle' && expectedRevision.value === null) return
  actionBusy.value = true
  actionError.value = null
  try {
    const payload: Record<string, unknown> = { type: actionType.value, request_id: crypto.randomUUID(), reason: reason.value }
    if (actionType.value === 'tenant.entitle') {
      payload.expected_revision = expectedRevision.value
      payload.features = buildVendorPolicy(featureKeys.value, currentFeatures.value as Record<string, VendorFeatureValue>, edits)
    }
    const operation = await request<{ id: string }>(`tenants/${encodeURIComponent(id.value)}/operations`, { method: 'POST', body: payload })
    reason.value = ''
    submitted.value = true
    await navigateTo({ path: `/operations/${encodeURIComponent(operation.id)}`, query: { returnTo: `/operations?tenant_id=${encodeURIComponent(id.value)}` } })
  } catch (cause) { actionError.value = cause }
  finally { actionBusy.value = false }
}

const operationLabels: Record<TenantOperation, string> = {
  'tenant.create': 'vendor.operations.types.tenant.create',
  'tenant.inspect': 'vendor.operations.types.tenant.inspect',
  health: 'vendor.operations.types.health',
  backup: 'vendor.operations.types.backup',
  'tenant.entitle': 'vendor.operations.types.tenant.entitle',
}
const operationTypes = computed(() => availableOperations.value.map(value => ({ value, label: t(operationLabels[value]) })))
const operationsNeedEnabling = computed(() => Boolean(data.value && !data.value.operations_enabled))
</script>

<template>

    <SharedUnsavedChanges :dirty="dirty" />
    <SharedRecordPage :title="data?.name ?? t('vendor.tenants.details')" :back-to="backTo" :loading="pending" :error="error" @retry="refresh">
      <template #actions><UButton v-if="data && commercialCustomer" :to="{ path: `/customers/${encodeURIComponent(commercialCustomer.id)}`, query: { returnTo: route.fullPath } }" color="neutral" variant="outline">{{ t('vendor.customers.openProfile') }}</UButton><UButton v-if="data" :to="{ path: '/operations', query: { tenant_id: data.id } }" color="neutral" variant="outline">{{ t('vendor.tenants.viewOperations') }}</UButton></template>

      <div v-if="data" class="space-y-6">
        <SharedRecordSection v-if="provisioning || provisioningError" class="lg:col-span-2" :title="t('vendor.tenants.provisioning.title')">
          <div aria-live="polite" class="grid gap-3">
            <UAlert v-if="provisioningError" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.unavailable')" />
            <UAlert v-else-if="provisioningFailed" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.failed')" :description="t('vendor.tenants.provisioning.failedHint')" />
            <p v-if="provisioning">{{ t(`vendor.tenants.provisioning.stages.${provisioningStage}`) }}</p>
            <p v-if="provisioning?.admin_login" class="text-sm"><span class="text-muted">{{ t('vendor.tenants.fields.adminLogin') }}: </span><bdi>{{ provisioning.admin_login }}</bdi></p>
            <p v-if="provisioningPollingPaused" class="text-sm text-muted">{{ t('vendor.tenants.provisioning.paused') }}</p>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton v-if="loginUrl" :to="loginUrl" external target="_blank" rel="noopener noreferrer" icon="i-lucide-external-link">{{ t('vendor.tenants.provisioning.open') }}</UButton>
            <UButton color="neutral" variant="outline" :disabled="!hydrated || provisioningPending" :loading="provisioningPending" @click="refreshSharedProvisioning">{{ t('vendor.common.refresh') }}</UButton>
          </div>
        </SharedRecordSection>

        <SharedRecordSection v-if="canVendor('vendor.tenants.manage')" :title="t('vendor.tenants.grantTitle')" :description="t('vendor.tenants.grantHint')">
          <UAlert v-if="grantError" class="mb-3" color="error" variant="subtle" :title="t(fieldErrorKey(grantError))" />
          <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="grantReason" required maxlength="1000" class="w-full" /></UFormField>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <UButton v-if="!data.operations_enabled" :loading="grantBusy" :disabled="grantBusy || !grantReason.trim()" @click="updateGrant(true)">{{ t('vendor.tenants.enableOperations') }}</UButton>
            <UButton v-else color="error" variant="ghost" :disabled="grantBusy" @click="confirmRevoke = true">{{ t('vendor.tenants.disableOperations') }}</UButton>
          </div>
          <SharedInlineConfirm v-if="confirmRevoke" class="mt-4" :title="t('vendor.tenants.confirmDisable')" :description="t('vendor.tenants.grantHint')" :confirm-label="t('vendor.tenants.disableOperations')" :pending="grantBusy" :disabled="!grantReason.trim()" @cancel="confirmRevoke = false" @confirm="updateGrant(false)" />
        </SharedRecordSection>

        <SharedRecordSection class="lg:col-span-2" :title="t('vendor.tenants.operationsTitle')" :description="t('vendor.tenants.operationsHint')">
          <UAlert v-if="operationsNeedEnabling" color="neutral" variant="subtle" :title="t('vendor.tenants.operationsDisabledHint')" />
          <UAlert v-else-if="!availableOperations.length" color="neutral" variant="subtle" :title="t('vendor.tenants.operationsUnavailableHint')" />
          <UAlert v-if="actionError" class="mb-4" color="error" variant="subtle" :title="t(fieldErrorKey(actionError))" />
          <form v-if="canVendor('vendor.operations.run') && !operationsNeedEnabling && availableOperations.length" class="grid gap-4" @submit.prevent="enqueueOperation">
            <UFormField :label="t('vendor.operations.type')" required><USelect v-model="actionType" :items="operationTypes" class="w-full sm:max-w-md" /></UFormField>
            <template v-if="actionType === 'tenant.entitle'">
              <p class="text-sm text-muted">{{ t('vendor.tenants.currentRevision', { revision: expectedRevision ?? t('vendor.common.unknown') }) }}</p>
              <p v-if="expectedRevision === null" role="alert" class="text-sm text-error">{{ t('vendor.tenants.revisionUnavailable') }}</p>
              <div v-for="[key, kind] in featureKeys" :key="key" class="max-w-xl rounded-md border border-default p-3">
                <label v-if="kind === 'boolean'" class="flex items-center gap-3"><UCheckbox v-model="edits[key]" :aria-label="t(`vendor.features.${key}`, key)" /><span>{{ t(`vendor.features.${key}`, key) }}</span></label>
                <UFormField v-else :label="t(`vendor.features.${key}`, key)" :help="t('vendor.tenants.limitHelp')"><UInput v-model="edits[key]" type="number" min="0" step="1" inputmode="numeric" class="w-full" /></UFormField>
              </div>
            </template>
            <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="reason" required maxlength="1000" class="w-full" /></UFormField>
            <div><UButton type="submit" :loading="actionBusy" :disabled="actionBusy || !reason.trim() || (actionType === 'tenant.entitle' && expectedRevision === null)">{{ t('vendor.operations.enqueue') }}</UButton></div>
          </form>
          <SharedForbiddenState v-else-if="!operationsNeedEnabling && availableOperations.length && !canVendor('vendor.operations.run')" />
        </SharedRecordSection>

        <SharedRecordSection class="lg:col-span-2" :title="t('vendor.tenants.policyTitle')" :description="t('vendor.tenants.policyHint')">
          <div class="grid gap-4 md:grid-cols-2">
            <section><h3 class="mb-2 text-sm font-medium">{{ t('vendor.tenants.desiredPolicy') }}</h3><dl class="grid gap-2 text-sm"><div v-for="[key, value] in Object.entries(data.desired_policy ?? {})" :key="key" class="flex justify-between gap-3"><dt>{{ t(`vendor.features.${key}`, key) }}</dt><dd><bdi>{{ policyValue(value) }}</bdi></dd></div><p v-if="!Object.keys(data.desired_policy ?? {}).length" class="text-muted">{{ t('vendor.common.none') }}</p></dl></section>
            <section><h3 class="mb-2 text-sm font-medium">{{ t('vendor.tenants.observedPolicy') }}</h3><dl class="grid gap-2 text-sm"><div v-for="[key, value] in Object.entries(data.observed_policy ?? {})" :key="key" class="flex justify-between gap-3"><dt>{{ t(`vendor.features.${key}`, key) }}</dt><dd><bdi>{{ policyValue(value) }}</bdi></dd></div><p v-if="!Object.keys(data.observed_policy ?? {}).length" class="text-muted">{{ t('vendor.common.none') }}</p></dl></section>
          </div>
        </SharedRecordSection>
      </div>

  <template #aside><SharedPropertiesPanel v-if="data">
            <SharedPropertyRow :label="t('vendor.tenants.fields.mode')" :value="t(`vendor.mode.${data.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`)" />
            <SharedPropertyRow :label="t('vendor.tenants.fields.hosting')" :value="t(`vendor.hosting.${data.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`)" />
            <SharedPropertyRow v-if="!provisioning" :label="t('vendor.tenants.target')"><bdi>{{ data.inventory_target }}</bdi></SharedPropertyRow>
            <SharedPropertyRow :label="t('vendor.tenants.fields.catalogVersion')">{{ data.catalog_version || t('vendor.common.none') }}<span v-if="data.catalog_tier"> · {{ t(`vendor.catalog.tiers.${data.catalog_tier}`, data.catalog_tier) }}</span></SharedPropertyRow>
            <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge :tone="operationStatusBadge(provisioning?.status ?? data.status).tone" :label="t(operationStatusBadge(provisioning?.status ?? data.status).labelKey)" /></SharedPropertyRow>
            <SharedPropertyRow :label="t('vendor.tenants.operations')" :value="data.operations_enabled ? t('vendor.common.enabled') : t('vendor.common.disabled')" />
          <SharedPropertyRow :label="t('vendor.tenants.healthChecked')" :value="data.health_checked_at ? formatNasqDateTime(data.health_checked_at, locale) : null" /></SharedPropertiesPanel></template>
</SharedRecordPage>
</template>
