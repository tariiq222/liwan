<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useQuery } from '@tanstack/vue-query'
import { StorageInventorySchema, type StorageInventory } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useCustomerCapabilities } from '@/composables/useSubscription'
import { firstQuery, parseOffset } from '@/utils/routeQuery'

type StorageRow = StorageInventory['items'][number] & { ownerTo: string | null }
type Filter = 'all' | 'blocked' | 'available'

const PAGE_SIZE = 25
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const { can: canCommercial } = useCustomerCapabilities()
const { $api } = useApi()
const recordLink = useRecordLink()
const hydrated = useHydrated()
const allowed = computed(() => can('settings.company.manage'))
const canBuy = computed(() => allowed.value && me.value?.commercial?.mode === 'saas' && canCommercial('subscription.manage'))
const filter = computed<Filter>(() => {
  const value = firstQuery(route.query.blocked)
  return value === 'true' ? 'blocked' : value === 'false' ? 'available' : 'all'
})
const offset = computed(() => {
  const value = parseOffset(route.query.offset)
  return Number.isSafeInteger(value) ? Math.floor(value / PAGE_SIZE) * PAGE_SIZE : 0
})
const filters = computed(() => [
  { value: 'all', label: t('settings.storage.filters.all') },
  { value: 'blocked', label: t('settings.storage.filters.blocked') },
  { value: 'available', label: t('settings.storage.filters.available') },
])
function setFilter(value: string) {
  if (!hydrated.value || !filters.value.some(item => item.value === value) || filter.value === value) return
  void router.replace({ query: { ...route.query, blocked: value === 'all' ? undefined : String(value === 'blocked'), offset: undefined } })
}
function setPage(page: number) {
  if (!hydrated.value || !Number.isSafeInteger(page) || page < 1 || page > pages.value) return
  void router.replace({ query: { ...route.query, offset: page > 1 ? String((page - 1) * PAGE_SIZE) : undefined } })
}
const query = useQuery({
  queryKey: computed(() => ['settings', 'storage', me.value?.id, me.value?.company.id, filter.value, offset.value]),
  enabled: computed(() => !!me.value && allowed.value),
  queryFn: ({ signal }) => $api('/api/v1/settings/storage', {
    query: { limit: PAGE_SIZE, offset: offset.value, blocked: filter.value === 'all' ? undefined : filter.value === 'blocked' },
    schema: StorageInventorySchema,
    signal,
  }),
})
const inventory = computed(() => query.data.value)
const rows = computed<StorageRow[]>(() => (inventory.value?.items ?? []).map(item => ({
  ...item,
  ownerTo: item.record ? recordLink(item.record.kind, item.record.id) : null,
})))
const total = computed(() => inventory.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const page = computed(() => Math.min(pages.value, offset.value / PAGE_SIZE + 1))
const columns = computed<TableColumn<StorageRow>[]>(() => [
  { accessorKey: 'name', header: t('settings.storage.name') },
  { accessorKey: 'size_bytes', header: t('settings.storage.size') },
  { accessorKey: 'created_at', header: t('settings.storage.created') },
  { accessorKey: 'blocked', header: t('settings.storage.state') },
  { accessorKey: 'ownerTo', header: t('settings.storage.owner') },
])
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const mib = (value: number) => t('settings.storage.mib', { value: number.format(value) })
function bytes(value: number) {
  if (value >= 1024 ** 2) return mib(value / (1024 ** 2))
  if (value >= 1024) return t('settings.storage.kib', { value: number.format(value / 1024) })
  return t('settings.storage.bytes', { value: number.format(value) })
}
const createdAt = (value: string | null) => formatDateTime(value, me.value?.tz || 'Asia/Riyadh') || t('settings.storage.unknownDate')
const stateLabel = (blocked: boolean) => t(blocked ? 'settings.storage.blocked' : 'settings.storage.available')
</script>

<template>
  <SharedListPage :title="t('settings.storage.title')" :description="t('settings.storage.description')" back-to="/settings/system">
    <template v-if="canBuy" #actions>
      <UButton to="/subscription/change" icon="i-lucide-plus" :disabled="!hydrated">{{ t('settings.storage.buy') }}</UButton>
    </template>
    <SharedForbiddenState v-if="!allowed" :description="t('settings.forbidden')" />
    <div v-else class="grid gap-(--liwan-gap-card)" data-testid="storage-inventory">
      <SharedRecordSection v-if="inventory?.summary" variant="panel" :title="t('settings.storage.tenantTotals')" :description="t('settings.storage.tenantScope')" data-testid="storage-summary">
        <SharedPropertiesPanel>
          <SharedPropertyRow :label="t('settings.storage.used')" :value="bytes(inventory.summary.used_bytes)" />
          <SharedPropertyRow :label="t('settings.storage.limit')" :value="inventory.summary.limit_mb === null ? t('settings.storage.unlimited') : mib(inventory.summary.limit_mb)" />
          <SharedPropertyRow :label="t('settings.storage.blockedSize')" :value="bytes(inventory.summary.blocked_bytes)" />
        </SharedPropertiesPanel>
      </SharedRecordSection>
      <p class="text-sm text-muted">{{ t('settings.storage.companyScope') }} {{ t('settings.storage.manageHint') }}</p>
      <SharedListCard>
        <template #filters>
          <SharedSegmentedControl :label="t('settings.storage.filter')" :items="filters" :model-value="filter" @update:model-value="setFilter" />
        </template>
        <SharedEmptyState v-if="inventory && !rows.length" class="m-(--liwan-card-pad)" :title="t('settings.storage.empty')" />
        <SharedDataTable v-else bare :rows="rows" :columns="columns" row-key="id" :caption="t('settings.storage.title')" :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()">
          <template #name-cell="{ row }"><bdi class="break-words font-medium">{{ row.original.name }}</bdi></template>
          <template #size_bytes-cell="{ row }">{{ bytes(row.original.size_bytes) }}</template>
          <template #created_at-cell="{ row }">{{ createdAt(row.original.created_at) }}</template>
          <template #blocked-cell="{ row }"><SharedStatusBadge :tone="row.original.blocked ? 'warning' : 'neutral'" :label="stateLabel(row.original.blocked)" /></template>
          <template #ownerTo-cell="{ row }">
            <UButton v-if="row.original.ownerTo" :to="row.original.ownerTo" size="sm" color="neutral" variant="link">{{ t('settings.storage.openOwner') }}</UButton>
            <span v-else class="text-sm text-muted">{{ t('settings.storage.ownerUnavailable') }}</span>
          </template>
          <template #mobile-row="{ row }">
            <div class="grid min-w-0 gap-2">
              <bdi class="break-words font-medium">{{ row.name }}</bdi>
              <span class="text-sm text-muted">{{ bytes(row.size_bytes) }} · {{ createdAt(row.created_at) }}</span>
              <div class="flex flex-wrap items-center gap-2">
                <SharedStatusBadge :tone="row.blocked ? 'warning' : 'neutral'" :label="stateLabel(row.blocked)" />
                <UButton v-if="row.ownerTo" :to="row.ownerTo" size="sm" color="neutral" variant="link">{{ t('settings.storage.openOwner') }}</UButton>
                <span v-else class="text-sm text-muted">{{ t('settings.storage.ownerUnavailable') }}</span>
              </div>
            </div>
          </template>
        </SharedDataTable>
        <template v-if="inventory && total" #footer>
          <SharedListFooter :count-label="t('settings.storage.resultCount', { shown: rows.length, total })" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="setPage" />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
</template>
