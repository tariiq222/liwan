<script setup lang="ts">
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'
import { operationStatusBadge } from '@/utils/vendorBadges'
import { buildVendorPolicy, type VendorFeatureValue } from '@/utils/vendorPolicy'
import type { VendorTenant } from '@/utils/vendorTenant'
import type { OperationFeed } from '@webvue/commercial-contracts'
type TenantOperation = 'tenant.create' | 'tenant.inspect' | 'health' | 'backup' | 'tenant.entitle'
const tenantOperationTypes = new Set<TenantOperation>(['tenant.create', 'tenant.inspect', 'health', 'backup', 'tenant.entitle'])
type Catalog = { version: string; status: string; solution: { tiers?: { id: string; name: string; features?: string[]; limits?: Record<string, number> }[] } }
const props = defineProps<{ tenantId: string }>()
/** True while a typed reason or limit change has not been sent; the page guards leaving with it. */
const dirtyModel = defineModel<boolean>('dirty', { default: false })
const { t, locale } = useI18n()
const { request } = useVendorApi()
const { can: canVendor } = useVendorContext()
const tenantId = toRef(props, 'tenantId')
const { data, error: tenantError, pending: tenantPending, refresh } = useVendorTenant(tenantId)
const { data: catalog } = useAsyncData('vendor:catalog-features', () => request<{ items: Catalog[]; total: number }>('catalog'))
const { data: recent, error: recentError, pending: recentPending, refresh: refreshRecent } = useTenantRecentOperations(tenantId)
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
const grantReason = ref('')
const grantError = ref<unknown>(null)
const grantBusy = ref(false)
const confirmRevoke = ref(false)
const confirmEnqueue = ref(false)
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
watch(dirty, value => { dirtyModel.value = value }, { immediate: true })
onBeforeUnmount(() => { dirtyModel.value = false })
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
    await request<VendorTenant>(`tenants/${encodeURIComponent(tenantId.value)}/operations-grant`, { method: 'POST', body: { enabled, reason: grantReason.value } })
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
    const operation = await request<{ id: string }>(`tenants/${encodeURIComponent(tenantId.value)}/operations`, { method: 'POST', body: payload })
    reason.value = ''
    submitted.value = true
    await navigateTo({ path: `/operations/${encodeURIComponent(operation.id)}`, query: { returnTo: `/operations?tenant_id=${encodeURIComponent(tenantId.value)}` } })
  } catch (cause) { actionError.value = cause }
  finally { actionBusy.value = false; confirmEnqueue.value = false }
}

const operationLabels: Record<TenantOperation, string> = {
  'tenant.create': 'vendor.operations.types.tenant.create',
  'tenant.inspect': 'vendor.operations.types.tenant.inspect',
  health: 'vendor.operations.types.health',
  backup: 'vendor.operations.types.backup',
  'tenant.entitle': 'vendor.operations.types.tenant.entitle',
}
const operationTypes = computed(() => availableOperations.value.map(value => ({ value, label: t(operationLabels[value]) })))
const pickedLabel = computed(() => operationTypes.value.find(operation => operation.value === actionType.value)?.label ?? '')
const canEnqueue = computed(() => Boolean(reason.value.trim()) && !(actionType.value === 'tenant.entitle' && expectedRevision.value === null))
// Anything the confirmation names (type, reason, limits, switches) closes it when it changes.
watch([actionType, reason, edits], () => { confirmEnqueue.value = false }, { deep: true })
const operationsNeedEnabling = computed(() => Boolean(data.value && !data.value.operations_enabled))
const operationTime = (op: OperationFeed) => formatWebVueDateTime(op.source === 'shared' ? (op.last_event_at ?? op.created_at) : op.updated_at, locale.value)
</script>

<template>
  <SharedPageState :loading="tenantPending && !data" :error="tenantError" @retry="refresh">
  <div v-if="data" class="space-y-6">
    <SharedRecordSection panel :title="t('vendor.tenants.operationsTitle')" :description="t('vendor.tenants.operationsHint')">
      <template #actions><SharedStatusBadge :tone="data.operations_enabled ? 'success' : 'neutral'" :label="data.operations_enabled ? t('vendor.tenants.operationsOn') : t('vendor.tenants.operationsOff')" /></template>
      <UAlert v-if="operationsNeedEnabling" color="neutral" variant="subtle" icon="i-lucide-lock" :title="t('vendor.tenants.operationsDisabledHint')" />
      <UAlert v-else-if="!availableOperations.length" color="neutral" variant="subtle" icon="i-lucide-info" :title="t('vendor.tenants.operationsUnavailableHint')" />
      <UAlert v-if="actionError" class="mb-4" color="error" variant="subtle" :title="t(fieldErrorKey(actionError))" />
      <form v-if="canVendor('vendor.operations.run') && !operationsNeedEnabling && availableOperations.length" class="grid gap-4" @submit.prevent="confirmEnqueue = canEnqueue">
        <UFormField :label="t('vendor.operations.type')" required><USelect v-model="actionType" :items="operationTypes" class="w-full sm:max-w-md" /></UFormField>
        <template v-if="actionType === 'tenant.entitle'">
          <p class="text-sm text-muted">{{ t('vendor.tenants.currentRevision', { revision: expectedRevision ?? t('vendor.common.unknown') }) }}</p>
          <p v-if="expectedRevision === null" role="alert" class="text-sm text-error">{{ t('vendor.tenants.revisionUnavailable') }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-for="[key, kind] in featureKeys" :key="key" class="rounded-lg p-3 ring ring-default">
              <label v-if="kind === 'boolean'" class="flex items-center gap-3"><UCheckbox v-model="edits[key]" :aria-label="t(`vendor.features.${key}`, key)" /><span>{{ t(`vendor.features.${key}`, key) }}</span></label>
              <UFormField v-else :label="t(`vendor.features.${key}`, key)" :help="t('vendor.tenants.limitHelp')"><UInput v-model="edits[key]" type="number" min="0" step="1" inputmode="numeric" class="w-full" /></UFormField>
            </div>
          </div>
        </template>
        <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="reason" required maxlength="1000" class="w-full" /></UFormField>
        <SharedInlineConfirm v-if="confirmEnqueue" color="warning" :title="t('vendor.tenants.confirmEnqueue', { type: pickedLabel })" :description="t('vendor.tenants.confirmEnqueueHint')" :confirm-label="t('vendor.operations.enqueue')" :pending="actionBusy" :disabled="actionBusy || !canEnqueue" @cancel="confirmEnqueue = false" @confirm="enqueueOperation" />
        <div v-else><UButton type="submit" icon="i-lucide-play" :disabled="actionBusy || !canEnqueue">{{ t('vendor.operations.enqueue') }}</UButton></div>
      </form>
      <SharedForbiddenState v-else-if="!operationsNeedEnabling && availableOperations.length && !canVendor('vendor.operations.run')" />
    </SharedRecordSection>

    <SharedRecordSection panel :title="t('vendor.tenants.recentOperations')">
      <template #actions><UButton :to="{ path: '/operations', query: { tenant_id: tenantId } }" color="neutral" variant="outline" size="sm">{{ t('vendor.tenants.viewOperations') }}</UButton></template>
      <SharedPageState :loading="recentPending && !recent" :error="recentError" @retry="refreshRecent">
      <p v-if="!recent?.length" class="text-sm text-muted">{{ t('vendor.operations.empty') }}</p>
      <ul v-else class="divide-y divide-default" data-testid="tenant-recent-operations">
        <li v-for="op in recent" :key="op.id" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
          <NuxtLink :to="{ path: `/operations/${encodeURIComponent(op.id)}`, query: { source: op.source, returnTo: `/operations?tenant_id=${encodeURIComponent(tenantId)}` } }" class="font-medium hover:underline">{{ t(`vendor.operations.types.${op.type}`, op.type) }}</NuxtLink>
          <span class="order-last basis-full text-xs text-muted sm:order-none sm:basis-auto sm:text-sm">{{ operationTime(op) }}</span>
          <SharedStatusBadge :tone="operationStatusBadge(op.status).tone" :label="operationStatusBadge(op.status).labelKey ? t(operationStatusBadge(op.status).labelKey) : op.status" />
        </li>
      </ul>
      </SharedPageState>
    </SharedRecordSection>

    <section v-if="canVendor('vendor.tenants.manage')" class="rounded-lg bg-default ring ring-error/40" aria-labelledby="operations-grant-title" data-testid="operations-danger-zone">
      <header class="flex items-start gap-3 border-b border-error/30 px-4 py-3">
        <UIcon name="i-lucide-shield-alert" class="mt-0.5 size-5 shrink-0 text-error" aria-hidden="true" />
        <div class="min-w-0">
          <h2 id="operations-grant-title" class="text-sm font-semibold text-highlighted">{{ t('vendor.tenants.dangerTitle') }}</h2>
          <p class="mt-1 text-sm text-muted">{{ t('vendor.tenants.grantHint') }}</p>
        </div>
      </header>
      <div class="space-y-4 p-4">
        <UAlert v-if="grantError" color="error" variant="subtle" :title="t(fieldErrorKey(grantError))" />
        <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="grantReason" required maxlength="1000" class="w-full" /></UFormField>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton v-if="!data.operations_enabled" :loading="grantBusy" :disabled="grantBusy || !grantReason.trim()" @click="updateGrant(true)">{{ t('vendor.tenants.enableOperations') }}</UButton>
          <UButton v-else color="error" variant="outline" :disabled="grantBusy" @click="confirmRevoke = true">{{ t('vendor.tenants.disableOperations') }}</UButton>
        </div>
        <SharedInlineConfirm v-if="confirmRevoke" :title="t('vendor.tenants.confirmDisable')" :description="t('vendor.tenants.grantHint')" :confirm-label="t('vendor.tenants.disableOperations')" :pending="grantBusy" :disabled="!grantReason.trim()" @cancel="confirmRevoke = false" @confirm="updateGrant(false)" />
      </div>
    </section>
  </div>
  </SharedPageState>
</template>
