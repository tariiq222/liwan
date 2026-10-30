<script setup lang="ts">
import type { AnalyticsFigure, Money } from '@liwan/commercial-contracts'
import { deltaOf, deltaTone, figureNumber, formatFigure, type Direction, type FigureFormat } from '@/utils/vendorAnalytics'

// One analytics figure: SharedMetricTile plus its change against the previous period. An unavailable
// figure shows the reason instead of a number (never a made-up zero).
const props = defineProps<{
  label: string
  current: AnalyticsFigure<number | Money>
  previous: AnalyticsFigure<number | Money>
  format: FigureFormat
  direction: Direction
  icon?: `i-lucide-${string}`
  unit?: string
}>()
const { t, locale } = useI18n()
const value = computed(() => formatFigure(props.current, props.format, locale.value))
const reason = computed(() => (props.current.available ? null : t(`analytics.unavailable.${props.current.reason}`)))
const delta = computed(() => deltaOf(figureNumber(props.current), figureNumber(props.previous)))
const tone = computed(() => (delta.value ? deltaTone(delta.value.change, props.direction) : 'neutral'))
const percent = computed(() => (delta.value?.percent == null ? null : new Intl.NumberFormat(locale.value.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US', { style: 'percent', maximumFractionDigits: 1 }).format(delta.value.percent)))
const ICONS = { up: 'i-lucide-arrow-up', down: 'i-lucide-arrow-down', flat: 'i-lucide-minus' } as const
const TONES = { good: 'text-success', bad: 'text-error', neutral: 'text-muted' } as const
</script>

<template>
  <SharedMetricTile :label="props.label" :value="value" :icon="props.icon" :unit="props.unit" value-dir="ltr" :hint="reason ?? undefined" data-testid="analytics-kpi">
    <p v-if="delta" class="flex items-center gap-1 text-xs" :class="TONES[tone]" data-testid="analytics-kpi-delta">
      <UIcon :name="ICONS[delta.change]" class="size-3.5" aria-hidden="true" />
      <span class="sr-only">{{ t(`analytics.delta.${delta.change}`) }}</span>
      <span class="tabular-nums" dir="ltr">{{ percent ?? t('analytics.delta.fromZero') }}</span>
      <span class="text-muted">{{ t('analytics.delta.vsPrevious') }}</span>
    </p>
  </SharedMetricTile>
</template>
