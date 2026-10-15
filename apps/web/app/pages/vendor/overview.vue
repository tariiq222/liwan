<script setup lang="ts">
import { commercialMetrics } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { formatNasqDateTime } from '@/composables/calendarDate'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t, locale } = useI18n()
const { can } = useVendorContext()
const { request } = useVendorApi()
const { data, error, pending, refresh } = await useAsyncData('vendor:overview:all', () => request<{ tenants: number; active: number; pending_operations: number; failed_operations: number; last_health_at: string | null }>('overview', { query: { source: 'all' } }))
const { data: commercial, pending: commercialPending } = await useAsyncData('vendor:overview:commercial', async () => {
  try {
    const page = await useVendorSubscriptions().listCustomers({ limit: 200, offset: 0 })
    return { metrics: commercialMetrics(page.items), total: page.total }
  } catch { return null }
})
</script>
<template>
  <SharedDashboardPage :title="t('vendor.overview.title')" :description="t('vendor.overview.description')">
    <template #metrics>
      <template v-if="data">
        <SharedMetricTile :label="t('vendor.overview.tenants')" :value="data.tenants" icon="i-lucide-building-2" />
        <SharedMetricTile :label="t('vendor.overview.active')" :value="data.active" icon="i-lucide-circle-check" />
        <SharedMetricTile :label="t('vendor.overview.pending')" :value="data.pending_operations" icon="i-lucide-loader-circle" />
        <SharedMetricTile :label="t('vendor.overview.failed')" :value="data.failed_operations" icon="i-lucide-circle-alert" />
      </template>
    </template>
    <div class="@min-[768px]:col-span-2">
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <p v-if="data" class="mt-4 text-sm text-muted">{{ t('vendor.overview.queueScope') }}</p>
      <p v-if="data?.last_health_at" class="mt-4 text-sm text-muted">{{ t('vendor.overview.lastHealth') }}: <time :datetime="data.last_health_at">{{ formatNasqDateTime(data.last_health_at, locale) }}</time></p>
      <section class="mt-8 @min-[768px]:col-span-2" data-testid="commercial-metrics" aria-labelledby="commercial-metrics-title">
        <h2 id="commercial-metrics-title" class="text-lg font-semibold">{{ t('vendor.overviewCommercial.title') }}</h2>
        <p class="mt-1 text-sm text-muted">{{ t('vendor.overviewCommercial.hint') }}</p>
        <p v-if="!commercialPending && !commercial" class="mt-3 text-sm text-muted">{{ t('vendor.overviewCommercial.unavailable') }}</p>
        <template v-else-if="commercial">
          <div class="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SharedMetricTile :label="t('vendor.overviewCommercial.active')" :value="commercial.metrics.active" icon="i-lucide-circle-check" />
            <SharedMetricTile :label="t('vendor.overviewCommercial.pending')" :value="commercial.metrics.pending" icon="i-lucide-loader-circle" />
            <SharedMetricTile :label="t('vendor.overviewCommercial.pastDue')" :value="commercial.metrics.pastDue" icon="i-lucide-alarm-clock" />
            <SharedMetricTile :label="t('vendor.overviewCommercial.renewals')" :value="commercial.metrics.upcomingRenewals" icon="i-lucide-calendar-clock" />
            <SharedMetricTile :label="t('vendor.overviewCommercial.stalled')" :value="commercial.metrics.stalledFulfillments" icon="i-lucide-circle-alert" />
            <SharedMetricTile :label="t('vendor.overviewCommercial.setup')" :value="commercial.metrics.setupRequired" icon="i-lucide-wrench" />
          </div>
          <p v-if="commercial.total > commercial.metrics.counted" class="mt-3 text-sm text-warning">{{ t('vendor.overviewCommercial.partial', { count: commercial.metrics.counted }, commercial.metrics.counted) }}</p>
        </template>
      </section>
      <nav class="mt-6 flex flex-wrap gap-3"><UButton to="/vendor/tenants">{{ t('vendor.tenants.title') }}</UButton><UButton to="/vendor/customers" color="neutral" variant="outline">{{ t('vendor.overviewCommercial.customers') }}</UButton><UButton v-if="can('vendor.billing.manage')" to="/vendor/invoices" color="neutral" variant="outline">{{ t('vendor.overviewCommercial.invoices') }}</UButton><UButton to="/vendor/catalog" color="neutral" variant="outline">{{ t('vendor.catalog.title') }}</UButton><UButton to="/vendor/operations" color="neutral" variant="outline">{{ t('vendor.operations.title') }}</UButton></nav>
    </SharedPageState>
    </div>
  </SharedDashboardPage>
</template>
