<script setup lang="ts">
import type { UsageSnapshot } from '@nasq/commercial-contracts'
import { formatBytes, usageDisplay, usageMetricLabel } from '@/utils/vendorSubscriptions'
import { formatDateTime } from '@nasq/ui/app/utils/formatDate'
const props = defineProps<{ usage?: UsageSnapshot | null }>()
const { t, te, locale } = useI18n()
const fmt = (unit: string, n: number) => (unit === 'attachment_bytes' ? formatBytes(n) : String(n))
const rows = computed(() => (props.usage?.metrics ?? []).map(m => ({ m, view: usageDisplay(m) })))
</script>
<template>
  <div class="space-y-3" data-slot="usage-meters">
    <p v-if="!usage" class="text-sm text-muted">{{ t('vendor.customers.usage.none') }}</p>
    <template v-else>
      <p class="flex flex-wrap items-center gap-2 text-sm text-muted">
        <SharedStatusBadge :tone="usage.freshness === 'fresh' ? 'success' : usage.freshness === 'stale' ? 'warning' : 'neutral'" variant="subtle" :label="t(`vendor.customers.usage.freshness.${usage.freshness}`)" />
        <span v-if="usage.observed_at">{{ t('vendor.customers.usage.observedAt') }}: <time :datetime="usage.observed_at">{{ formatDateTime(usage.observed_at) }}</time></span>
      </p>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li v-for="{ m, view } in rows" :key="m.key" class="rounded-lg p-3 ring ring-default" data-testid="usage-meter">
          <p class="text-sm text-muted">{{ usageMetricLabel(m, t, te) }}</p>
          <p v-if="view.available" class="font-semibold tabular-nums">{{ fmt(m.unit, view.used as number) }} <span class="font-normal text-muted">/ {{ m.limit === null ? t('vendor.pricing.limit.unlimited') : fmt(m.unit, m.limit) }}</span></p>
          <p v-else class="font-medium text-warning-800 dark:text-warning">{{ t('vendor.customers.usage.unavailable') }}<span v-if="m.reason" class="ms-1 text-xs font-normal text-muted">({{ t(`vendor.customers.usage.reasons.${m.reason}`) }})</span></p>
          <UProgress v-if="view.ratio !== null" :model-value="Math.round(view.ratio * 100)" size="xs" class="mt-2" />
        </li>
      </ul>
    </template>
  </div>
</template>
