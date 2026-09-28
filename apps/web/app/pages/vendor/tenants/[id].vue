<script setup lang="ts">
import { buildVendorPolicy, type VendorFeatureValue } from '@/utils/vendorPolicy'
import { safeReturnTo } from '@/utils/safeReturnTo'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
type Tenant = { id: string; name: string; commercial_mode: string; hosting_model: string; inventory_target: string; catalog_version: string | null; catalog_tier: string | null; status: string; desired_policy: Record<string, any> | null; observed_policy: Record<string, any> | null; policy_revision: number | null; health_checked_at: string | null; operations_enabled: boolean; available_operations?: unknown; created_at: string }
type TenantOperation = 'tenant.create' | 'tenant.inspect' | 'health' | 'backup' | 'tenant.entitle'
const tenantOperationTypes = new Set<TenantOperation>(['tenant.create', 'tenant.inspect', 'health', 'backup', 'tenant.entitle'])
type Catalog = { version: string; status: string; solution: { tiers?: { id: string; name: string; features?: string[]; limits?: Record<string, number> }[] } }
const { t } = useI18n()
const route = useRoute()
const { request } = useVendorApi()
const vendorContext = useVendorContext()
const { can } = vendorContext
const id = computed(() => String(route.params.id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/vendor/tenants', ['/vendor/tenants']))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:tenant:${id.value}`, () => request<Tenant>(`tenants/${encodeURIComponent(id.value)}`))
const { data: catalog } = await useAsyncData('vendor:catalog-features', () => request<{ items: Catalog[]; total: number }>('catalog'))
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
    await navigateTo({ path: `/vendor/operations/${encodeURIComponent(operation.id)}`, query: { returnTo: `/vendor/operations?tenant_id=${encodeURIComponent(id.value)}` } })
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
  <SharedPageContainer width="list">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedPageHeader :title="data?.name ?? t('vendor.tenants.details')" :back-to="backTo">
      <template #actions><UButton v-if="data" :to="{ path: '/vendor/operations', query: { tenant_id: data.id } }" color="neutral" variant="outline">{{ t('vendor.tenants.viewOperations') }}</UButton></template>
    </SharedPageHeader>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !data" @retry="refresh">
      <div v-if="data" class="grid gap-5 lg:grid-cols-2">
        <UCard>
          <dl class="grid gap-4 sm:grid-cols-2">
            <div><dt class="text-sm text-muted">{{ t('vendor.tenants.fields.mode') }}</dt><dd class="mt-1">{{ t(`vendor.mode.${data.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.tenants.fields.hosting') }}</dt><dd class="mt-1">{{ t(`vendor.hosting.${data.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.tenants.target') }}</dt><dd class="mt-1"><bdi>{{ data.inventory_target }}</bdi></dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.tenants.fields.catalogVersion') }}</dt><dd class="mt-1">{{ data.catalog_version || t('vendor.common.none') }}<span v-if="data.catalog_tier"> · {{ t(`vendor.catalog.tiers.${data.catalog_tier}`, data.catalog_tier) }}</span></dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.common.status') }}</dt><dd class="mt-1"><UBadge color="neutral" variant="subtle">{{ t(`vendor.status.${data.status}`) }}</UBadge></dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.tenants.operations') }}</dt><dd class="mt-1">{{ data.operations_enabled ? t('vendor.common.enabled') : t('vendor.common.disabled') }}</dd></div>
          </dl>
          <p v-if="data.health_checked_at" class="mt-4 text-sm text-muted">{{ t('vendor.tenants.healthChecked') }}: <time :datetime="data.health_checked_at">{{ new Date(data.health_checked_at).toLocaleString() }}</time></p>
        </UCard>

        <UCard v-if="canVendor('vendor.tenants.manage')">
          <template #header><h2 class="font-semibold">{{ t('vendor.tenants.grantTitle') }}</h2><p class="text-sm text-muted">{{ t('vendor.tenants.grantHint') }}</p></template>
          <UAlert v-if="grantError" class="mb-3" color="error" variant="subtle" :title="t(fieldErrorKey(grantError))" />
          <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="grantReason" required maxlength="1000" class="w-full" /></UFormField>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <UButton v-if="!data.operations_enabled" :loading="grantBusy" :disabled="grantBusy || !grantReason.trim()" @click="updateGrant(true)">{{ t('vendor.tenants.enableOperations') }}</UButton>
            <UButton v-else color="error" variant="ghost" :disabled="grantBusy" @click="confirmRevoke = true">{{ t('vendor.tenants.disableOperations') }}</UButton>
          </div>
          <SharedInlineConfirm v-if="confirmRevoke" class="mt-4" :title="t('vendor.tenants.confirmDisable')" :description="t('vendor.tenants.grantHint')" :confirm-label="t('vendor.tenants.disableOperations')" :pending="grantBusy" :disabled="!grantReason.trim()" @cancel="confirmRevoke = false" @confirm="updateGrant(false)" />
        </UCard>

        <UCard class="lg:col-span-2">
          <template #header><h2 class="font-semibold">{{ t('vendor.tenants.operationsTitle') }}</h2><p class="text-sm text-muted">{{ t('vendor.tenants.operationsHint') }}</p></template>
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
          <p v-else-if="!operationsNeedEnabling && availableOperations.length && !canVendor('vendor.operations.run')" class="text-sm text-muted">{{ t('vendor.forbidden') }}</p>
        </UCard>

        <UCard class="lg:col-span-2">
          <template #header><h2 class="font-semibold">{{ t('vendor.tenants.policyTitle') }}</h2><p class="text-sm text-muted">{{ t('vendor.tenants.policyHint') }}</p></template>
          <div class="grid gap-4 md:grid-cols-2">
            <section><h3 class="mb-2 text-sm font-medium">{{ t('vendor.tenants.desiredPolicy') }}</h3><dl class="grid gap-2 text-sm"><div v-for="[key, value] in Object.entries(data.desired_policy ?? {})" :key="key" class="flex justify-between gap-3"><dt>{{ t(`vendor.features.${key}`, key) }}</dt><dd><bdi>{{ policyValue(value) }}</bdi></dd></div><p v-if="!Object.keys(data.desired_policy ?? {}).length" class="text-muted">{{ t('vendor.common.none') }}</p></dl></section>
            <section><h3 class="mb-2 text-sm font-medium">{{ t('vendor.tenants.observedPolicy') }}</h3><dl class="grid gap-2 text-sm"><div v-for="[key, value] in Object.entries(data.observed_policy ?? {})" :key="key" class="flex justify-between gap-3"><dt>{{ t(`vendor.features.${key}`, key) }}</dt><dd><bdi>{{ policyValue(value) }}</bdi></dd></div><p v-if="!Object.keys(data.observed_policy ?? {}).length" class="text-muted">{{ t('vendor.common.none') }}</p></dl></section>
          </div>
        </UCard>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
