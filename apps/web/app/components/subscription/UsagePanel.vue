<script setup lang="ts">
import type { UsageSnapshot } from '@webvue/commercial-contracts'
import { usageFigure, usageMetricLabel } from '@/utils/subscription'
const props = defineProps<{ usage: UsageSnapshot }>()
const { t, te, locale } = useI18n()
const num = (n: number) => new Intl.NumberFormat(locale.value.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US').format(n)
const rows = computed(() => props.usage.metrics.map(m => ({ m, f: usageFigure(m, props.usage.freshness) })))
</script>
<template>
  <div class="space-y-3" data-slot="usage-panel" :data-freshness="usage.freshness">
    <p v-if="usage.freshness === 'unavailable'" role="status" class="text-sm text-muted">{{ t('subscription.usage.unavailableNote') }}</p>
    <p v-else class="text-xs text-muted">
      <SharedStatusBadge :tone="usage.freshness === 'stale' ? 'warning' : 'success'" variant="subtle" size="sm" :label="t(usage.freshness === 'stale' ? 'subscription.usage.stale' : 'subscription.usage.fresh')" />
      <span v-if="usage.observed_at" class="ms-2">{{ t('subscription.usage.observed') }} <bdi dir="ltr">{{ usage.observed_at }}</bdi></span>
    </p>
    <dl class="grid gap-3 sm:grid-cols-2">
      <div v-for="{ m, f } in rows" :key="m.key" class="rounded-lg p-3 ring ring-default" data-testid="usage-metric" :data-known="f.known">
        <dt class="text-sm text-muted">{{ usageMetricLabel(m, t, te) }}</dt>
        <dd class="mt-1 font-semibold tabular-nums">
          <span v-if="!f.known" class="text-muted">{{ t('subscription.usage.unavailable') }}</span>
          <span v-else>{{ num(f.value!) }} <span class="font-normal text-muted">{{ t('subscription.usage.of') }} {{ f.limit === null ? t('subscription.usage.unlimited') : num(f.limit) }}</span></span>
        </dd>
      </div>
    </dl>
  </div>
</template>
