<script setup lang="ts">
import type { ChartConfig } from '@/components/charts'
import type { ChartPalette, ChartTone, DashboardBarChart, DashboardChart, DashboardDonutChart } from '@/utils/projectChartData'
import { useMediaQuery, useMutationObserver } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Position } from '@unovis/ts'
import { VisAxis, VisDonut, VisGroupedBar, VisTooltip, VisXYContainer, VisSingleContainer, VisDonutSelectors, VisGroupedBarSelectors } from '@unovis/vue'
import { ChartContainer, ChartLegendContent, ChartTooltipContent, componentToString } from '@/components/charts'

const props = withDefaults(defineProps<{
  chart: DashboardChart
  accessibleLabel: string
  height?: string
  variant?: 'pie' | 'donut' | 'donut-text'
}>(), {
  height: '300px',
  variant: 'donut-text',
})

const { mode, fontSize } = useAppearance()
const { locale, localeProperties } = useI18n()
// RTL charts: the plot itself stays `direction: ltr` (SVG text-anchor flips with the direction
// and would push labels into the axis), so the mirroring is done in the data: column charts list
// their categories in reverse (the first one lands at the right), horizontal bars plot negated
// values so zero sits at the right edge and bars grow leftwards, and the value axis of a column
// chart moves to the right. Unovis scales cannot simply be reversed: its bars need an ascending domain.
// Text, legends and tooltips inherit the page direction.
const isRtl = computed(() => localeProperties.value.dir === 'rtl')
const tokens = ref<Record<string, string>>({})
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const motionEpoch = ref(0)

function readTokens() {
  if (typeof document === 'undefined') return
  const styles = getComputedStyle(document.documentElement)
  tokens.value = Object.fromEntries([
    '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--muted-foreground', '--border', '--foreground', '--card', '--font-sans',
    '--status-success', '--status-info', '--status-warning', '--status-danger',
    '--chart-status-success', '--chart-status-info', '--chart-status-warning', '--chart-status-error', '--chart-status-neutral',
  ].map(name => [name, styles.getPropertyValue(name).trim()]))
}

function token(name: string, fallback: string) {
  return tokens.value[name] || fallback
}

const chartColors = computed(() => [
  token('--chart-1', '#007ff8'),
  token('--chart-2', '#3a5191'),
  token('--chart-3', '#6b7fb8'),
  token('--chart-4', '#9ab0d8'),
  token('--chart-5', '#5b6b8c'),
  token('--chart-6', '#8b97b1'),
])

// Semantic marks take the status tokens, which are fixed per mode and independent of the tenant brand;
// `primary` is the brand-led first categorical colour.
const TONE_TOKEN: Record<ChartTone, [string[], string]> = {
  success: [['--chart-status-success', '--status-success'], '#15803d'],
  info: [['--chart-status-info', '--status-info'], '#2563eb'],
  warning: [['--chart-status-warning', '--status-warning'], '#d97706'],
  danger: [['--chart-status-error', '--status-danger'], '#dc2626'],
  neutral: [['--chart-status-neutral', '--muted-foreground'], '#64748b'],
  primary: [['--chart-1'], '#007ff8'],
}
const toneColor = (tone: ChartTone) => {
  const [names, fallback] = TONE_TOKEN[tone]
  for (const name of names) if (tokens.value[name]) return tokens.value[name]!
  return fallback
}

function colorsFor(_kind: DashboardChart['kind'], chartPalette: ChartPalette, count: number) {
  const colors = chartPalette === 'status'
    ? chartColors.value
    : chartPalette === 'task'
      ? chartColors.value.slice(0, 3)
      : chartPalette === 'budget'
        ? chartColors.value.slice(3, 6)
        : chartPalette === 'finance'
          ? [chartColors.value[1]!, chartColors.value[0]!]
          : [chartColors.value[1]!]
  return Array.from({ length: count }, (_, index) => colors[index % colors.length]!)
}

const chartConfig = computed<ChartConfig>(() => {
  const chart = props.chart
  if (chart.kind === 'donut') {
    const colors = donutColors.value
    return Object.fromEntries(chart.data.map((item, index) => [String(index), { label: item.name, color: colors[index] }]))
  }
  const colors = barColors.value
  return Object.fromEntries(chart.series.map((item, index) => [item.key, { label: item.label, color: colors[index] }]))
})

const donutData = computed(() => props.chart.kind === 'donut' ? props.chart.data : [])
const donut = computed<DashboardDonutChart | null>(() => props.chart.kind === 'donut' ? props.chart : null)
const bars = computed<DashboardBarChart | null>(() => props.chart.kind === 'bar' ? props.chart : null)
const donutPalette = computed(() => donut.value?.palette ?? 'primary' as ChartPalette)
const donutLength = computed(() => donut.value?.data.length ?? 0)
const donutColors = computed(() => {
  const fallback = colorsFor('donut', donutPalette.value, donutLength.value)
  return (donut.value?.data ?? []).map((item, index) => item.tone ? toneColor(item.tone) : fallback[index]!)
})
const barPalette = computed(() => bars.value?.palette ?? 'primary' as ChartPalette)
const barColors = computed(() => colorsFor('bar', barPalette.value, bars.value?.series.length ?? 0))
const barData = computed(() => bars.value?.data ?? [])
const mirrorValues = computed(() => isRtl.value && bars.value?.orientation === 'horizontal')
const plotData = computed(() => isRtl.value && bars.value?.orientation === 'vertical' ? [...barData.value].reverse() : barData.value)
const barColor = (datum: { tone?: ChartTone }, seriesIndex: number) => datum.tone ? toneColor(datum.tone) : barColors.value[seriesIndex]
const panelHeight = computed(() => Number.parseInt(props.height, 10) || 300)
const donutPlotHeight = computed(() => Math.min(250, Math.max(190, panelHeight.value - 40)))
const barLegendHeight = computed(() => bars.value && bars.value.series.length > 1 ? 32 : 0)
const barPlotHeight = computed(() => {
  if (bars.value?.orientation !== 'horizontal') return Math.max(160, panelHeight.value - barLegendHeight.value)
  return Math.max(240, barData.value.length * 34)
})
const barChartWidth = computed(() => {
  if (bars.value?.orientation !== 'vertical') return '100%'
  return `max(100%, ${Math.max(1, barData.value.length) * (barData.value.length > 8 ? 88 : 72)}px)`
})
const chartDuration = computed(() => prefersReducedMotion.value || barData.value.length > 120 ? 0 : 560)

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const formatNumber = (value: number) => numberFormatter.value.format(value)
const percentFormatter = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }))
const formatPercent = (value: number) => percentFormatter.value.format(value / 100)
const barXDomain = computed<[number, number] | undefined>(() => {
  if (!bars.value) return undefined
  if (bars.value.orientation === 'horizontal') {
    const max = bars.value.maxValue ?? 100
    return mirrorValues.value ? [-max, 0] : [0, max]
  }
  return [0, Math.max(barData.value.length - 1, 0)]
})
const barYDomain = computed<[number, number | undefined]>(() => bars.value?.orientation === 'horizontal'
  ? [0, Math.max(barData.value.length - 1, 0)]
  : [0, bars.value?.maxValue ?? undefined])
const valueTick = (value: number | Date) => {
  const number = Math.abs(Number(value))
  if (bars.value?.valueFormat === 'percent') return formatPercent(number)
  return Number.isInteger(number) ? formatNumber(number) : ''
}
// A column's label slot is its bar slot; the width it wraps at follows the plot's minimum column width.
const barTickWidth = computed(() => (barData.value.length > 8 ? 88 : 72) - 8)
const axisSide = computed(() => isRtl.value ? Position.Right : Position.Left)

const barX = (_datum: unknown, index: number) => index
const barY = (datum: { values: Record<string, number | null> }, _index: number, seriesIndex: number) => {
  const key = bars.value?.series[seriesIndex]?.key
  const value = key ? datum.values[key] : null
  return value == null ? Number.NaN : mirrorValues.value ? -value : value
}
const barTick = (value: number | Date) => {
  const index = typeof value === 'number' ? Math.round(value) : 0
  const item = plotData.value[index]
  if (!item) return ''
  const specialValues = bars.value?.series.flatMap((series) => {
    const itemValue = item.values[series.key]
    const display = item.displayValues?.[series.key]
    const special = itemValue == null || itemValue === 0 || item.progressState === 'unknown' || item.progressState === 'no_tasks'
    if (!special || !display) return []
    return [series.label ? `${series.label}: ${display}` : display]
  }) ?? []
  return specialValues.length ? `${specialValues.join(' · ')} · ${item.name}` : item.name
}
const barTickValues = computed(() => plotData.value.map((_item, index) => index))

function tooltipContent(label: string, payload: Record<string, unknown>, x = 0) {
  const renderer = componentToString(
    chartConfig.value,
    ChartTooltipContent as unknown as new () => { $props: Record<string, unknown> },
    { x, labelFormatter: () => label, payload, config: chartConfig.value },
  )
  const html = renderer ? renderer(payload, x) : undefined
  return html ? `<div dir="${isRtl.value ? 'rtl' : 'ltr'}">${html}</div>` : undefined
}

function donutTooltip(raw: unknown) {
  const datum = (raw && typeof raw === 'object' && 'data' in raw ? (raw as { data: unknown }).data : raw) as { name?: string; value?: number } | null
  if (!datum) return undefined
  const index = donutData.value.findIndex(item => item.name === datum.name && item.value === datum.value)
  const key = index >= 0 ? String(index) : '0'
  return tooltipContent(datum.name ?? '', { [key]: datum.value ?? 0 })
}

function barTooltip(raw: unknown) {
  const datum = (raw && typeof raw === 'object' && 'data' in raw ? (raw as { data: unknown }).data : raw) as { name?: string; values?: Record<string, number | null>; unavailable?: string; stateLabel?: string; displayValues?: Record<string, string> } | null
  if (!datum || !bars.value) return undefined
  const payload: Record<string, unknown> = {}
  bars.value.series.forEach(series => {
    const value = datum.values?.[series.key]
    payload[series.key] = datum.displayValues?.[series.key] ?? (value == null ? datum.stateLabel ?? datum.unavailable ?? '—' : value)
  })
  return tooltipContent(datum.name ?? '', payload)
}

const donutTooltipTriggers = computed(() => ({ [VisDonutSelectors.segment]: donutTooltip }))
const barTooltipTriggers = computed(() => ({ [VisGroupedBarSelectors.bar]: barTooltip }))

useMutationObserver(() => document.documentElement, readTokens, { attributes: true, attributeFilter: ['class', 'style', 'data-font-size'] })

watch(prefersReducedMotion, (reducedMotion, previousReducedMotion) => {
  if (reducedMotion && !previousReducedMotion) {
    // Unovis bar transitions are D3-managed and cannot be cancelled through the
    // public component API. Remount only on the reduce edge so the current
    // geometry is committed immediately with duration=0.
    motionEpoch.value += 1
  }
})

onMounted(readTokens)
watch([mode, fontSize], () => { void nextTick(readTokens) }, { flush: 'post' })
</script>

<template>
  <div
    data-testid="chart-canvas"
    data-chart-library="unovis"
    role="group"
    :aria-label="accessibleLabel"
    class="min-w-0 w-full overflow-hidden"
    :style="{ height: donut ? 'auto' : height, minHeight: donut ? height : undefined }"
  >
    <ChartContainer
      v-if="donut"
      class="chart-donut-container h-full !aspect-auto gap-2"
      :config="chartConfig"
      :style="{
        '--vis-donut-central-label-font-size': fontSize === 'large' ? '32px' : '30px',
        '--vis-donut-central-label-font-weight': '700',
        '--vis-donut-central-sub-label-font-size': 'var(--project-type-caption, 12px)',
      }"
    >
      <div class="chart-donut-body">
        <VisSingleContainer :key="motionEpoch" :data="donutData" :height="donutPlotHeight" :duration="0" class="chart-donut-svg min-h-0 w-full max-w-[250px] shrink-0">
          <VisDonut
            :value="(item: { value: number }) => item.value"
            :color="donutColors"
            :radius="96"
            :arc-width="props.variant === 'pie' ? 96 : 36"
            :corner-radius="0"
            :central-label="props.variant === 'donut-text' ? donut.centerLabel : undefined"
            :central-sub-label="props.variant === 'donut-text' ? donut.centerSubLabel : undefined"
            :central-sub-label-wrap="true"
            :show-empty-segments="false"
            :pad-angle="0"
            :duration="0"
          />
          <VisTooltip :triggers="donutTooltipTriggers" />
        </VisSingleContainer>
        <ul class="chart-donut-legend" :aria-label="accessibleLabel">
          <li v-for="(item, index) in donut.data" :key="`${item.name}-${index}`" class="chart-donut-legend-item">
            <span class="chart-donut-legend-swatch" :style="{ backgroundColor: donutColors[index] }" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ item.name }}</span>
            <span class="shrink-0 tabular-nums text-highlighted">{{ formatNumber(item.value) }}</span>
          </li>
        </ul>
      </div>
    </ChartContainer>

    <ChartContainer
      v-else-if="bars"
      class="chart-bar-container h-full"
      :config="chartConfig"
      :style="{ '--vis-axis-tick-label-font-size': `var(--project-type-caption, ${fontSize === 'large' ? '16px' : '12px'})` }"
    >
      <div class="chart-bar-stack min-h-0 min-w-0" :class="bars.orientation === 'horizontal' ? 'overflow-y-auto' : 'overflow-x-auto'">
        <div class="chart-bar-plot" dir="ltr" :style="{ height: `${barPlotHeight}px`, width: barChartWidth, '--chart-motion-duration': `${chartDuration}ms` }">
          <VisXYContainer
            :key="`${motionEpoch}-${isRtl}`"
            :data="plotData"
            :height="barPlotHeight"
            :duration="chartDuration"
            :x-domain="barXDomain"
            :y-domain="barYDomain"
            :prevent-empty-domain="true"
            class="w-full"
          >
            <VisGroupedBar
              :x="barX"
              :y="bars.series.map((_series, index) => (datum: { values: Record<string, number | null> }, rowIndex: number) => barY(datum, rowIndex, index))"
              :orientation="bars.orientation"
              :rounded-corners="6"
              :group-padding="0.16"
              :bar-padding="0.12"
              :bar-min-height="0"
              :duration="chartDuration"
              :color="(datum: { tone?: ChartTone }, seriesIndex: number) => barColor(datum, seriesIndex)"
            />
            <VisAxis v-if="bars.orientation === 'horizontal'" type="x" position="top" :tick-format="valueTick" :grid-line="true" :domain-line="false" :tick-line="false" :duration="chartDuration" />
            <VisAxis v-else type="x" :tick-values="barTickValues" :tick-format="barTick" :tick-text-angle="0" :tick-text-fit-mode="'wrap'" :tick-text-width="barTickWidth" :tick-text-separator="' · '" :grid-line="false" :domain-line="false" :duration="chartDuration" />
            <VisAxis v-if="bars.orientation === 'horizontal'" type="y" :position="axisSide" :tick-values="barTickValues" :tick-format="barTick" :tick-text-fit-mode="'wrap'" :tick-text-width="220" :tick-text-separator="' · '" :grid-line="false" :domain-line="false" :tick-line="false" :duration="chartDuration" />
            <VisAxis v-else type="y" :position="axisSide" :tick-format="valueTick" :grid-line="true" :domain-line="false" :tick-line="false" :duration="chartDuration" />
            <VisTooltip :triggers="barTooltipTriggers" />
          </VisXYContainer>
        </div>
        <ChartLegendContent v-if="bars.series.length > 1" :config="chartConfig" vertical-align="bottom" class="chart-bar-legend w-full flex-wrap gap-x-4 gap-y-1 px-2 text-xs" />
      </div>
    </ChartContainer>
  </div>
</template>
