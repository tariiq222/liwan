<script setup lang="ts">
import { formatNasqDateTime } from '@/composables/calendarDate'
import type { TableColumn } from '@nuxt/ui'
import { operationStatusBadge } from '@/utils/commercialBadges'
import type { OperationFeed } from '@nasq/commercial-contracts'
import FilterBar from '@/components/shared/FilterBar.vue'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const { request } = useVendorApi()
const tenantId = computed({ get: () => typeof route.query.tenant_id === 'string' ? route.query.tenant_id : '', set: value => router.replace({ query: { ...route.query, tenant_id: value || undefined } }) })
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:operations:all:${tenantId.value}:${route.query.page ?? '1'}`, () => request<{ items: OperationFeed[]; total: number }>('operations', { query: { source: 'all', tenant_id: tenantId.value || undefined, page: route.query.page } }))

const items = computed(() => data.value?.items ?? [])
const operationTo = (op: OperationFeed) => ({ path: `/vendor/operations/${op.id}`, query: { source: op.source, returnTo: route.fullPath } })
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

<template #filters><FilterBar :active-count="tenantId ? 1 : 0" @clear="tenantId = ''">
      <template #search><UInput v-model="tenantId" :aria-label="t('vendor.operations.tenantFilter')" :placeholder="t('vendor.operations.tenantFilter')" /></template>
    </FilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="operations-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>

<SharedDataTable  :rows="items" :columns="columns" row-key="id" :row-to="operationTo" :loading="pending" :error="error" :empty-text="t('vendor.operations.empty')" :caption="t('vendor.operations.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => router.replace({ query: { ...route.query, page: value } })">
  <template #type-cell="{ row: { original: op } }"><NuxtLink :to="operationTo(op)" data-testid="operation-row" class="font-medium hover:underline">{{ t(`vendor.operations.types.${op.type}`,op.type) }}</NuxtLink></template>
  <template #status-cell="{ row: { original: op } }"><SharedStatusBadge  :tone="operationStatusBadge(op.status).tone" :label="operationStatusBadge(op.status).labelKey ? t(operationStatusBadge(op.status).labelKey) : op.status" /></template>
  <template #stage-cell="{ row: { original: op } }">{{ t(`vendor.operations.stages.${op.stage}`,op.stage) }}</template>
  <template #target-cell="{ row: { original: op } }"><bdi>{{ op.tenant_id }}</bdi></template>
  <template #time-cell="{ row: { original: op } }">{{ operationTime(op) }}</template>
  <template #mobile-row="{ row: op }"><div class="flex flex-wrap justify-between gap-2"><NuxtLink :to="operationTo(op)" data-testid="operation-row" class="font-medium">{{ t(`vendor.operations.types.${op.type}`, op.type) }}</NuxtLink><SharedStatusBadge  :tone="operationStatusBadge(op.status).tone" :label="operationStatusBadge(op.status).labelKey ? t(operationStatusBadge(op.status).labelKey) : op.status" /></div>
          <p class="mt-1 text-sm text-muted">{{ t('vendor.operations.stage') }}: {{ t(`vendor.operations.stages.${op.stage}`, op.stage) }} · {{ t('vendor.operations.target') }}: <bdi>{{ op.tenant_id }}</bdi></p>
          <p class="mt-1 text-xs text-muted">{{ operationTime(op) }}</p></template>
</SharedDataTable>
</SharedListPage>
</template>
