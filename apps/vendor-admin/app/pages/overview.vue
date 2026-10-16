<script setup lang="ts">
import { ATTENTION_LIMIT, type Attention } from '@nasq/commercial-contracts'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
import type { StatusStat } from '@/utils/vendorAttention'
definePageMeta({ capability: 'vendor.read' })
const { t, locale } = useI18n()
const { request } = useVendorApi()
const { data, error, pending, refresh } = await useAsyncData('vendor:overview:all', () => request<{ tenants: number, active: number, pending_operations: number, failed_operations: number, last_health_at: string | null }>('overview', { query: { source: 'all' } }))
const { data: attention, pending: attentionPending } = await useAsyncData('vendor:overview:attention', async () => {
  try { return await request<Attention>('commercial/attention') } catch { return null }
})
const now = new Date()

// Each count opens the list it counts, filtered where the list has the filter (past due, stalled, pending and renewals have none).
const stats = computed<StatusStat[]>(() => {
  const d = data.value
  if (!d) return []
  const c = attention.value?.counts
  const s = (id: string, value: number, to?: string): StatusStat => ({ id, label: t(`vendor.today.status.${id}`), value, to })
  return [
    s('failedOperations', d.failed_operations, '/operations?status=attention'),
    s('pendingOperations', d.pending_operations, '/operations?status=pending'),
    s('tenants', d.tenants, '/customers'),
    s('tenantsActive', d.active, '/customers'),
    ...(c ? [
      s('subscriptionsActive', c.subscriptions_active, '/customers?state=active'),
      s('subscriptionsPending', c.subscriptions_pending),
      s('pastDue', c.past_due),
      s('stalled', c.stalled),
      s('setupRequired', c.setup_required, '/customers?state=setup_required'),
      s('renewals', c.renewals),
    ] : []),
  ]
})
</script>
<template>
  <SharedDashboardPage :title="t('vendor.today.title')" :description="t('vendor.today.description')">
    <div class="space-y-8 @min-[768px]:col-span-2">
      <SharedPageState :loading="pending || attentionPending" :error="error" @retry="refresh">
        <section data-testid="today-attention" aria-labelledby="today-attention-title" class="space-y-3">
          <h2 id="today-attention-title" class="text-lg font-semibold">{{ t('vendor.today.attentionTitle') }}</h2>
          <p v-if="!attention" class="text-sm text-warning">{{ t('vendor.today.attentionUnavailable') }}</p>
          <SharedEmptyState v-else-if="!attention.items.length" :title="t('vendor.today.nothing')" :description="t('vendor.today.nothingHint')" data-testid="today-empty">
            <template #icon><UIcon name="i-lucide-circle-check" class="size-8" /></template>
          </SharedEmptyState>
          <template v-else>
            <VendorAttentionList :items="attention.items" :now="now" />
            <p v-if="attention.total > attention.items.length" class="text-sm text-muted">{{ t('vendor.today.moreItems', { shown: ATTENTION_LIMIT, total: attention.total }) }}</p>
          </template>
        </section>
        <section data-testid="today-status" aria-labelledby="today-status-title" class="space-y-3">
          <h2 id="today-status-title" class="text-lg font-semibold">{{ t('vendor.today.statusTitle') }}</h2>
          <VendorStatusStrip :stats="stats" :label="t('vendor.today.statusLabel')" />
          <p class="text-sm text-muted">{{ t('vendor.today.statusHint') }}</p>
          <p v-if="data?.last_health_at" class="text-sm text-muted">{{ t('vendor.today.lastHealth') }}: <time :datetime="data.last_health_at">{{ formatNasqDateTime(data.last_health_at, locale) }}</time></p>
        </section>
      </SharedPageState>
    </div>
  </SharedDashboardPage>
</template>
