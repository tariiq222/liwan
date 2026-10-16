<script setup lang="ts">
import { commercialMetrics, type CommercialMetrics } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
definePageMeta({ capability: 'vendor.read' })
const { t, locale } = useI18n()
const { request } = useVendorApi()
const { data, error, pending, refresh } = await useAsyncData('vendor:overview:all', () => request<{ tenants: number; active: number; pending_operations: number; failed_operations: number; last_health_at: string | null }>('overview', { query: { source: 'all' } }))
const { data: commercial, pending: commercialPending } = await useAsyncData('vendor:overview:commercial', async () => {
  try {
    const page = await useVendorSubscriptions().listCustomers({ limit: 200, offset: 0 })
    return { metrics: commercialMetrics(page.items), total: page.total }
  } catch { return null }
})

type Tile = { id: string, label: string, value: number, icon: `i-lucide-${string}`, to?: string }
const commercialMetric = (id: string, label: string, icon: Tile['icon'], pick: (metrics: CommercialMetrics) => number, to?: string): Tile[] =>
  commercial.value ? [{ id, label: t(`vendor.overviewCommercial.${label}`), value: pick(commercial.value.metrics), icon, to }] : []
// Each tile opens the list it counts, filtered to that subset where the list has the filter (past due, stalled, pending and renewals have none; the failed-state filter misses stalled orders still waiting).
const sections = computed(() => {
  const d = data.value
  if (!d) return []
  const attention: Tile[] = [
    { id: 'failed', label: t('vendor.overview.failed'), value: d.failed_operations, icon: 'i-lucide-circle-alert', to: '/operations?status=attention' },
    ...commercialMetric('pastDue', 'pastDue', 'i-lucide-alarm-clock', m => m.pastDue),
    ...commercialMetric('stalled', 'stalled', 'i-lucide-hourglass', m => m.stalledFulfillments),
    ...commercialMetric('setup', 'setup', 'i-lucide-wrench', m => m.setupRequired, '/customers?state=setup_required'),
  ]
  const status: Tile[] = [
    { id: 'tenants', label: t('vendor.overview.tenants'), value: d.tenants, icon: 'i-lucide-building-2', to: '/tenants' },
    { id: 'active', label: t('vendor.overview.active'), value: d.active, icon: 'i-lucide-circle-check', to: '/tenants' },
    { id: 'pending', label: t('vendor.overview.pending'), value: d.pending_operations, icon: 'i-lucide-loader-circle', to: '/operations?status=pending' },
    ...commercialMetric('subscriptionsActive', 'active', 'i-lucide-badge-check', m => m.active, '/customers?state=active'),
    ...commercialMetric('subscriptionsPending', 'pending', 'i-lucide-clock', m => m.pending),
    ...commercialMetric('renewals', 'renewals', 'i-lucide-calendar-clock', m => m.upcomingRenewals),
  ]
  return [{ id: 'attention', title: t('vendor.overview.attention'), tiles: attention }, { id: 'status', title: t('vendor.overview.status'), tiles: status }]
})
</script>
<template>
  <SharedDashboardPage :title="t('vendor.overview.title')" :description="t('vendor.overview.description')">
    <div class="@min-[768px]:col-span-2">
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <section v-for="section in sections" :key="section.id" class="mb-8" :data-testid="`overview-${section.id}`" :aria-labelledby="`overview-${section.id}-title`">
        <h2 :id="`overview-${section.id}-title`" class="text-lg font-semibold">{{ section.title }}</h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <template v-for="tile in section.tiles" :key="tile.id">
            <NuxtLink v-if="tile.to" :to="tile.to" class="block rounded-lg focus-visible:outline-2 focus-visible:outline-primary" :data-testid="`overview-tile-${tile.id}`">
              <SharedMetricTile :label="tile.label" :value="tile.value" :icon="tile.icon" />
            </NuxtLink>
            <SharedMetricTile v-else :label="tile.label" :value="tile.value" :icon="tile.icon" :data-testid="`overview-tile-${tile.id}`" />
          </template>
        </div>
      </section>
      <p v-if="data" class="text-sm text-muted">{{ t('vendor.overview.queueScope') }}</p>
      <p v-if="data?.last_health_at" class="mt-2 text-sm text-muted">{{ t('vendor.overview.lastHealth') }}: <time :datetime="data.last_health_at">{{ formatNasqDateTime(data.last_health_at, locale) }}</time></p>
      <p v-if="!commercialPending && !commercial" class="mt-2 text-sm text-muted">{{ t('vendor.overviewCommercial.unavailable') }}</p>
      <template v-else-if="commercial">
        <p class="mt-2 text-sm text-muted">{{ t('vendor.overviewCommercial.hint') }}</p>
        <p v-if="commercial.total > commercial.metrics.counted" class="mt-2 text-sm text-warning">{{ t('vendor.overviewCommercial.partial', { count: commercial.metrics.counted }, commercial.metrics.counted) }}</p>
      </template>
    </SharedPageState>
    </div>
  </SharedDashboardPage>
</template>
