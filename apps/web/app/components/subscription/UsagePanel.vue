<script setup lang="ts">
import type { UsageSnapshot } from '@webvue/commercial-contracts'
import { usageFigure, usageMetricLabel } from '@/utils/subscription'
const props = defineProps<{ usage: UsageSnapshot }>()
const { t, te, locale } = useI18n()
const WARN_AT = 75
const DANGER_AT = 90
const num = (n: number) => new Intl.NumberFormat(locale.value.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US').format(n)
// Share of the limit used; unknown or unlimited metrics draw no bar.
const percent = (value: number | null, limit: number | null) => (value === null || !limit ? undefined : (value / limit) * 100)
const tone = (pct: number | undefined) => (pct === undefined || pct < WARN_AT ? 'neutral' : pct < DANGER_AT ? 'warning' : 'danger')
const rows = computed(() => props.usage.metrics.map((m) => {
  const f = usageFigure(m, props.usage.freshness)
  const pct = percent(f.value, f.limit)
  return { m, f, pct, tone: tone(pct) as 'neutral' | 'warning' | 'danger' }
}))
</script>
<template>
  <div class="space-y-3" data-slot="usage-panel" :data-freshness="usage.freshness">
    <p v-if="usage.freshness === 'unavailable'" role="status" class="text-sm text-muted">{{ t('subscription.usage.unavailableNote') }}</p>
    <p v-else class="flex flex-wrap items-center gap-2 text-xs text-muted">
      <SharedStatusBadge :tone="usage.freshness === 'stale' ? 'warning' : 'success'" variant="subtle" size="sm" :label="t(usage.freshness === 'stale' ? 'subscription.usage.stale' : 'subscription.usage.fresh')" />
      <span v-if="usage.observed_at">{{ t('subscription.usage.observed') }} <bdi dir="ltr">{{ usage.observed_at }}</bdi></span>
    </p>
    <div class="grid gap-(--webvue-gap-card) sm:grid-cols-2">
      <div v-for="{ m, f, pct, tone: meter } in rows" :key="m.key" data-testid="usage-metric" :data-known="f.known">
        <SharedMetricTile
          :label="usageMetricLabel(m, t, te)"
          :value="f.known ? num(f.value!) : t('subscription.usage.unavailable')"
          value-dir="ltr"
          :hint="f.known ? `${t('subscription.usage.of')} ${f.limit === null ? t('subscription.usage.unlimited') : num(f.limit)}` : undefined"
          :progress="pct"
          :tone="meter"
        />
      </div>
    </div>
  </div>
</template>
