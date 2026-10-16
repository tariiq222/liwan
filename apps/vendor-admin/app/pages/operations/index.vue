<script setup lang="ts">
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
import type { TableColumn } from '@nuxt/ui'
import { operationStatusBadge } from '@/utils/vendorBadges'
import type { OperationFeed } from '@nasq/commercial-contracts'
import { OPERATION_STATUS_FILTERS, operationFilterLabelKey, operationStatusFilter } from '@/utils/vendorOperations'
definePageMeta({ capability: 'vendor.read' })
const { t, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const { request } = useVendorApi()
const TENANT_PAGE = 25
const MAX_TENANT_PAGES = 8
const tenantId = computed(() => (typeof route.query.tenant_id === 'string' ? route.query.tenant_id : ''))
const status = computed(() => operationStatusFilter(route.query.status))
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/operations', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:operations:all:${tenantId.value}:${status.value}:${page.value}`, () => request<{ items: OperationFeed[]; total: number }>('operations', { query: { source: 'all', tenant_id: tenantId.value || undefined, status: status.value === 'all' ? undefined : status.value, page: page.value > 1 ? page.value : undefined } }), { watch: [tenantId, status, page] })
// The tenant list is paged; the picker and the target column read names from the first pages and fall back to the id.
const { data: tenants } = await useAsyncData('vendor:operations:tenants', async () => {
  const names: { id: string; name: string }[] = []
  try {
    for (let next = 1; next <= MAX_TENANT_PAGES; next++) {
      const result = await request<{ items: { id: string; name: string }[]; total: number }>('tenants', { query: { page: next > 1 ? next : undefined } })
      names.push(...result.items)
      if (next * TENANT_PAGE >= result.total) break
    }
  } catch { /* the filter then lists only the selected id */ }
  return names
})
const tenantName = (id: string) => tenants.value?.find(tenant => tenant.id === id)?.name ?? id
const tenantItems = computed(() => {
  const known = (tenants.value ?? []).map(tenant => ({ value: tenant.id, label: tenant.name }))
  const selected = tenantId.value && !known.some(item => item.value === tenantId.value) ? [{ value: tenantId.value, label: tenantId.value }] : []
  return [{ value: 'all', label: t('vendor.operations.allTenants') }, ...selected, ...known]
})
const statusItems = computed(() => OPERATION_STATUS_FILTERS.map(value => ({ value, label: t(operationFilterLabelKey(value)) })))
const filtered = computed(() => Boolean(tenantId.value) || status.value !== 'all')

const items = computed(() => data.value?.items ?? [])
const operationTo = (op: OperationFeed) => ({ path: `/operations/${op.id}`, query: { source: op.source, returnTo: route.fullPath } })
function operationTime(op: OperationFeed) {
 const value = op.source === 'shared' ? (op.last_event_at ?? op.created_at) : op.updated_at
 const time = new Date(value ?? '')
 return `${t(op.source === 'shared' ? (op.last_event_at ? 'vendor.operations.lastEvent' : 'vendor.operations.created') : 'vendor.operations.updated')}: ${Number.isNaN(time.getTime()) ? t('app.notAvailable') : formatNasqDateTime(time, locale.value)}`
}

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'type', header: t('vendor.operations.type') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'stage', header: t('vendor.operations.stage') },
  { id: 'target', header: t('vendor.operations.target') },
  { id: 'time', header: t('vendor.operations.updated') },
])
</script>
<template>
<SharedListPage :title="t('vendor.operations.title')">

<template #filters><SharedFilterBar :active-count="Number(Boolean(tenantId)) + Number(status !== 'all')" @clear="router.replace('/operations')">
      <SharedFilterField :label="t('vendor.operations.tenantFilter')" for="operations-tenant"><USelect id="operations-tenant" :model-value="tenantId || 'all'" :items="tenantItems" class="w-full" :disabled="!hydrated" @update:model-value="patch({ tenant_id: $event && $event !== 'all' ? $event : undefined })" /></SharedFilterField>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="tenantId" :label="tenantName(tenantId)" @remove="patch({ tenant_id: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(operationFilterLabelKey(status))" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="operations-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>

<SharedDataTable  :rows="items" :columns="columns" row-key="id" :row-to="operationTo" :loading="pending" :error="error" :empty-text="t(filtered ? 'vendor.operations.noResults' : 'vendor.operations.empty')" :caption="t('vendor.operations.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #type-cell="{ row: { original: op } }"><NuxtLink :to="operationTo(op)" data-testid="operation-row" class="font-medium hover:underline">{{ t(`vendor.operations.types.${op.type}`,op.type) }}</NuxtLink></template>
  <template #status-cell="{ row: { original: op } }"><SharedStatusBadge  :tone="operationStatusBadge(op.status).tone" :label="operationStatusBadge(op.status).labelKey ? t(operationStatusBadge(op.status).labelKey) : op.status" /></template>
  <template #stage-cell="{ row: { original: op } }">{{ t(`vendor.operations.stages.${op.stage}`,op.stage) }}</template>
  <template #target-cell="{ row: { original: op } }"><bdi>{{ tenantName(op.tenant_id) }}</bdi></template>
  <template #time-cell="{ row: { original: op } }">{{ operationTime(op) }}</template>
  <template #mobile-row="{ row: op }"><div class="flex flex-wrap justify-between gap-2"><NuxtLink :to="operationTo(op)" data-testid="operation-row" class="font-medium">{{ t(`vendor.operations.types.${op.type}`, op.type) }}</NuxtLink><SharedStatusBadge  :tone="operationStatusBadge(op.status).tone" :label="operationStatusBadge(op.status).labelKey ? t(operationStatusBadge(op.status).labelKey) : op.status" /></div>
          <p class="mt-1 text-sm text-muted">{{ t('vendor.operations.stage') }}: {{ t(`vendor.operations.stages.${op.stage}`, op.stage) }} · {{ t('vendor.operations.target') }}: <bdi>{{ tenantName(op.tenant_id) }}</bdi></p>
          <p class="mt-1 text-xs text-muted">{{ operationTime(op) }}</p></template>
</SharedDataTable>
</SharedListPage>
</template>
