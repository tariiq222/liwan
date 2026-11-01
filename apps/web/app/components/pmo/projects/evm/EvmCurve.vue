<script setup lang="ts">
import type { ProjectEvm } from '@liwan/contracts'
import { useMutationObserver } from '@vueuse/core'
import { VisAxis, VisLine, VisScatter, VisXYContainer } from '@unovis/vue'
import { formatMoney } from '@/utils/projectFinance'
import { curveSeries } from './evm'

// The planned value over the baseline span, with today's earned value and actual cost as two marks. The plot stays
// `direction: ltr` (SVG text anchors flip with the direction), like the dashboard charts; text around it follows the page.
const props = defineProps<{ evm: ProjectEvm }>()
const { t, locale } = useI18n()
const { mode } = useAppearance()
const tokens = ref<Record<string, string>>({})
function readTokens() {
  if (typeof document === 'undefined') return
  const styles = getComputedStyle(document.documentElement)
  tokens.value = Object.fromEntries(['--chart-1', '--chart-status-success', '--chart-status-warning', '--border'].map(name => [name, styles.getPropertyValue(name).trim()]))
}
useMutationObserver(() => document.documentElement, readTokens, { attributes: true, attributeFilter: ['class', 'style'] })
onMounted(readTokens)
watch(mode, () => nextTick(readTokens), { flush: 'post' })

const colors = computed(() => ({
  pv: tokens.value['--chart-1'] || '#5b3f8c',
  ev: tokens.value['--chart-status-success'] || '#15803d',
  ac: tokens.value['--chart-status-warning'] || '#d97706',
}))
const series = computed(() => curveSeries(props.evm.planned_curve, props.evm.as_of))
const marks = computed(() => [
  { day: series.value.today, value: props.evm.ev, color: colors.value.ev },
  { day: series.value.today, value: props.evm.ac, color: colors.value.ac },
])
const top = computed(() => Math.max(props.evm.bac, props.evm.ev, props.evm.ac, 1) * 1.08)
const dayFormat = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric', timeZone: 'UTC' }))
const compact = computed(() => new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }))
const money = (value: number) => props.evm.currency ? formatMoney(value, props.evm.currency) : String(value)
const legend = computed(() => (['pv', 'ev', 'ac'] as const).map(key => ({ key, label: t(`projects.evm.series.${key}`), value: money(props.evm[key]), color: colors.value[key] })))
</script>

<template>
  <div data-testid="evm-curve" class="space-y-3">
    <div role="img" :aria-label="t('projects.evm.curveLabel')" class="h-64 w-full overflow-hidden" dir="ltr">
      <VisXYContainer :data="series.points" :height="256" :x-domain="[series.first, series.last]" :y-domain="[0, top]">
        <VisLine :x="(d: { day: number }) => d.day" :y="(d: { pv: number }) => d.pv" :color="colors.pv" :line-width="3" />
        <VisScatter :data="marks" :x="(d: { day: number }) => d.day" :y="(d: { value: number }) => d.value" :color="(d: { color: string }) => d.color" :size="14" :stroke-width="2" />
        <VisAxis type="x" :num-ticks="5" :tick-format="(day: number) => dayFormat.format(day * 86_400_000)" :grid-line="false" :domain-line="false" />
        <VisAxis type="y" :num-ticks="4" :tick-format="(value: number) => compact.format(value)" :grid-line="true" :domain-line="false" :tick-line="false" />
      </VisXYContainer>
    </div>
    <ul class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" data-testid="evm-curve-legend">
      <li v-for="item in legend" :key="item.key" class="inline-flex items-center gap-2">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: item.color }" aria-hidden="true" />
        <span>{{ item.label }}</span>
        <bdi dir="ltr" class="tabular-nums text-highlighted">{{ item.value }}</bdi>
      </li>
    </ul>
  </div>
</template>
