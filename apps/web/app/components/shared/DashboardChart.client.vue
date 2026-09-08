<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart'
import type { ChartPalette, DashboardBarChart, DashboardChart, DashboardDonutChart } from '@/utils/projectChartData'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VisAxis, VisDonut, VisGroupedBar, VisTooltip, VisXYContainer, VisSingleContainer, VisDonutSelectors, VisGroupedBarSelectors } from '@unovis/vue'
import { ChartContainer, ChartLegendContent, ChartTooltipContent, componentToString } from '@/components/ui/chart'

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
const { locale } = useI18n()
const tokens = ref<Record<string, string>>({})
const prefersReducedMotion = ref(false)
const chartRoot = ref<HTMLElement | null>(null)
let themeObserver: MutationObserver | null = null
let motionMediaQuery: MediaQueryList | null = null
let motionListener: (() => void) | null = null
let entranceFrame = 0
let entranceObserver: IntersectionObserver | null = null
const entrancePlayed = ref(false)
const motionEpoch = ref(0)
const fullDonutAngleRange: [number, number] = [0, Math.PI * 2]
const donutAngleRange = ref<[number, number]>([0, 0.0001])

function readTokens() {
  if (typeof document === 'undefined') return
  const styles = getComputedStyle(document.documentElement)
  tokens.value = Object.fromEntries([
    '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--muted-foreground', '--border', '--foreground', '--card', '--font-sans',
  ].map(name => [name, styles.getPropertyValue(name).trim()]))
}

function token(name: string, fallback: string) {
  return tokens.value[name] || fallback
}

const chartColors = computed(() => [
  token('--chart-1', '#18181b'),
  token('--chart-2', '#313136'),
  token('--chart-3', '#4a4a50'),
  token('--chart-4', '#63636a'),
  token('--chart-5', '#7b7b83'),
  token('--chart-6', '#94949c'),
])

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
    const colors = colorsFor(chart.kind, chart.palette, chart.data.length)
    return Object.fromEntries(chart.data.map((item, index) => [String(index), { label: item.name, color: colors[index] }]))
  }
  const colors = colorsFor(chart.kind, chart.palette, chart.series.length)
  return Object.fromEntries(chart.series.map((item, index) => [item.key, { label: item.label, color: colors[index] }]))
})

const donutData = computed(() => props.chart.kind === 'donut' ? props.chart.data : [])
const donut = computed<DashboardDonutChart | null>(() => props.chart.kind === 'donut' ? props.chart : null)
const bars = computed<DashboardBarChart | null>(() => props.chart.kind === 'bar' ? props.chart : null)
const donutPalette = computed(() => donut.value?.palette ?? 'primary' as ChartPalette)
const donutLength = computed(() => donut.value?.data.length ?? 0)
const donutColors = computed(() => colorsFor('donut', donutPalette.value, donutLength.value))
const barPalette = computed(() => bars.value?.palette ?? 'primary' as ChartPalette)
const barColors = computed(() => colorsFor('bar', barPalette.value, bars.value?.series.length ?? 0))
const barData = computed(() => bars.value?.data ?? [])
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
const donutDuration = computed(() => prefersReducedMotion.value ? 0 : 900)
const chartDuration = computed(() => prefersReducedMotion.value || barData.value.length > 120 ? 0 : 560)

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const formatNumber = (value: number) => numberFormatter.value.format(value)

const barX = (_datum: unknown, index: number) => index
const barY = (datum: { values: Record<string, number | null> }, _index: number, seriesIndex: number) => {
  const key = bars.value?.series[seriesIndex]?.key
  const value = key ? datum.values[key] : null
  return value == null ? Number.NaN : value
}
const barTick = (value: number | Date) => {
  const index = typeof value === 'number' ? Math.round(value) : 0
  const item = barData.value[index]
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
const barTickValues = computed(() => barData.value.map((_item, index) => index))
const percentTick = (value: number | Date) => `${value}%`

function tooltipContent(label: string, payload: Record<string, unknown>, x = 0) {
  const renderer = componentToString(
    chartConfig.value,
    ChartTooltipContent as unknown as new () => { $props: Record<string, unknown> },
    { x, labelFormatter: () => label, payload, config: chartConfig.value },
  )
  return renderer ? renderer(payload, x) : undefined
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
    payload[series.key] = value == null ? datum.displayValues?.[series.key] ?? datum.stateLabel ?? datum.unavailable ?? '—' : value
  })
  return tooltipContent(datum.name ?? '', payload)
}

const donutTooltipTriggers = computed(() => ({ [VisDonutSelectors.segment]: donutTooltip }))
const barTooltipTriggers = computed(() => ({ [VisGroupedBarSelectors.bar]: barTooltip }))

onMounted(() => {
  readTokens()
  themeObserver = new MutationObserver(readTokens)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-font-size'] })
  motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  let previousReducedMotion = false
  motionListener = () => {
    const reducedMotion = motionMediaQuery?.matches ?? false
    if (reducedMotion && !previousReducedMotion) {
      // Unovis transitions are D3-managed and cannot be cancelled through the
      // public component API. Remount only on the reduce edge so the current
      // geometry is committed immediately with duration=0.
      motionEpoch.value += 1
      donutAngleRange.value = [...fullDonutAngleRange]
    }
    prefersReducedMotion.value = reducedMotion
    previousReducedMotion = reducedMotion
  }
  motionListener()
  motionMediaQuery.addEventListener?.('change', motionListener)
  const playEntrance = () => {
    if (entrancePlayed.value || prefersReducedMotion.value) return
    entrancePlayed.value = true
    donutAngleRange.value = [...fullDonutAngleRange]
  }
  if (prefersReducedMotion.value) {
    donutAngleRange.value = [...fullDonutAngleRange]
  } else if (typeof IntersectionObserver === 'undefined' || !chartRoot.value) {
    entranceFrame = requestAnimationFrame(playEntrance)
  } else {
    entranceObserver = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        playEntrance()
        entranceObserver?.disconnect()
      }
    }, { threshold: 0.1 })
    entranceObserver.observe(chartRoot.value)
  }
})
onBeforeUnmount(() => {
  themeObserver?.disconnect()
  cancelAnimationFrame(entranceFrame)
  entranceObserver?.disconnect()
  if (motionListener) motionMediaQuery?.removeEventListener?.('change', motionListener)
})
watch([mode, fontSize], () => { void nextTick(readTokens) }, { flush: 'post' })
</script>

<template>
  <div
    data-testid="chart-canvas"
    data-chart-library="unovis"
    ref="chartRoot"
    role="group"
    dir="ltr"
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
        '--vis-donut-central-sub-label-font-size': '12px',
      }"
    >
      <div class="chart-donut-body">
        <VisSingleContainer :key="motionEpoch" :data="donutData" :height="donutPlotHeight" :duration="donutDuration" :style="{ '--chart-motion-duration': `${donutDuration}ms` }" class="chart-donut-svg min-h-0 w-full max-w-[250px] shrink-0">
          <VisDonut
            :value="(item: { value: number }) => item.value"
            :color="donutColors"
            :angle-range="donutAngleRange"
            :radius="96"
            :arc-width="props.variant === 'pie' ? 96 : 36"
            :corner-radius="0"
            :central-label="props.variant === 'donut-text' ? donut.centerLabel : undefined"
            :central-sub-label="props.variant === 'donut-text' ? donut.centerSubLabel : undefined"
            :central-sub-label-wrap="true"
            :show-empty-segments="false"
            :pad-angle="0"
            :duration="donutDuration"
          />
          <VisTooltip :triggers="donutTooltipTriggers" />
        </VisSingleContainer>
        <ul class="chart-donut-legend" :aria-label="accessibleLabel">
          <li v-for="(item, index) in donut.data" :key="`${item.name}-${index}`" class="chart-donut-legend-item">
            <span class="chart-donut-legend-swatch" :style="{ backgroundColor: donutColors[index] }" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ item.name }}</span>
            <span class="shrink-0 tabular-nums text-foreground">{{ formatNumber(item.value) }}</span>
          </li>
        </ul>
      </div>
    </ChartContainer>

    <ChartContainer
      v-else-if="bars"
      class="chart-bar-container h-full"
      :config="chartConfig"
      :style="{ '--vis-axis-tick-label-font-size': fontSize === 'large' ? '16px' : '12px' }"
    >
      <div class="chart-bar-stack min-h-0 min-w-0" :class="bars.orientation === 'horizontal' ? 'overflow-y-auto' : 'overflow-x-auto'">
        <div class="chart-bar-plot" :style="{ height: `${barPlotHeight}px`, width: barChartWidth, '--chart-motion-duration': `${chartDuration}ms` }">
          <VisXYContainer
            :key="motionEpoch"
            :data="barData"
            :height="barPlotHeight"
            :duration="chartDuration"
            :x-domain="bars.orientation === 'horizontal' ? [0, bars.maxValue ?? undefined] : [0, barData.length - 1]"
            :y-domain="bars.orientation === 'horizontal' ? [0, barData.length - 1] : [0, bars.maxValue ?? undefined]"
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
              :color="barColors"
            />
            <VisAxis v-if="bars.orientation === 'horizontal'" type="x" position="top" :tick-format="percentTick" :grid-line="true" :domain-line="false" :tick-line="false" :duration="chartDuration" />
            <VisAxis v-else type="x" :tick-values="barTickValues" :tick-format="barTick" :tick-text-angle="barData.length > 5 ? 24 : 0" :tick-text-fit-mode="'wrap'" :tick-text-width="160" :tick-text-separator="' · '" :grid-line="false" :domain-line="false" :duration="chartDuration" />
            <VisAxis v-if="bars.orientation === 'horizontal'" type="y" :tick-values="barTickValues" :tick-format="barTick" :tick-text-fit-mode="'wrap'" :tick-text-width="220" :tick-text-separator="' · '" :grid-line="false" :domain-line="false" :duration="chartDuration" />
            <VisAxis v-else type="y" :tick-format="(value: number | Date) => String(value)" :grid-line="true" :domain-line="false" :tick-line="false" :duration="chartDuration" />
            <VisTooltip :triggers="barTooltipTriggers" />
          </VisXYContainer>
        </div>
        <ChartLegendContent v-if="bars.series.length > 1" vertical-align="bottom" class="chart-bar-legend w-full flex-wrap gap-x-4 gap-y-1 px-2 text-xs" />
      </div>
    </ChartContainer>
  </div>
</template>

<style scoped>
.chart-donut-container {
  height: auto !important;
}

.chart-donut-body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.chart-donut-svg {
  min-height: 0;
}

.chart-donut-svg :deep(path[class*="-segment"]),
.chart-bar-plot :deep(path[class*="-bar"]) {
  transition: fill var(--chart-motion-duration, 0ms) ease, filter 160ms ease !important;
}

.chart-donut-svg :deep(path[class*="-segment"]:hover),
.chart-bar-plot :deep(path[class*="-bar"]:hover) {
  filter: brightness(1.12);
}

.chart-donut-legend {
  display: flex;
  width: 100%;
  min-height: 0;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: center;
  gap: 0.4rem 1rem;
  padding: 0 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.chart-donut-legend-item {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.4rem;
}

.chart-donut-legend-swatch {
  width: 0.5rem;
  height: 0.5rem;
  flex: 0 0 auto;
  border-radius: 9999px;
}

.chart-bar-stack {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.chart-bar-plot {
  min-height: 0;
  flex: 0 0 auto;
}

.chart-bar-legend {
  min-height: 2rem;
  flex: 0 0 auto;
}

@media (prefers-reduced-motion: reduce) {
  .chart-donut-svg :deep(path[class*="-segment"]),
  .chart-bar-plot :deep(path[class*="-bar"]) {
    transition: none !important;
  }

  .chart-donut-svg :deep(path[class*="-segment"]:hover),
  .chart-bar-plot :deep(path[class*="-bar"]:hover) {
    filter: none !important;
  }
}
</style>
