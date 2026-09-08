<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { registerLocale, use } from 'echarts/core'
import arabicLocale from 'echarts/lib/i18n/langAR.js'
import { BarChart, PieChart } from 'echarts/charts'
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

registerLocale('AR', arabicLocale)

use([SVGRenderer, BarChart, PieChart, AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent])

type ChartOption = Record<string, unknown>

const props = withDefaults(defineProps<{
  option: ChartOption
  accessibleLabel: string
  height?: string
}>(), {
  height: '300px',
})

const { mode, fontSize } = useAppearance()
const { locale } = useI18n()
const initOptions = computed(() => ({ renderer: 'svg' as const, locale: locale.value.startsWith('ar') ? 'AR' : 'EN' }))
const tokens = ref<Record<string, string>>({})
let themeObserver: MutationObserver | null = null

function readTokens() {
  if (typeof document === 'undefined') return
  const styles = getComputedStyle(document.documentElement)
  tokens.value = Object.fromEntries([
    '--brand-link', '--primary', '--status-success', '--status-warning', '--destructive', '--muted-foreground', '--border', '--foreground', '--card', '--font-sans',
  ].map(name => [name, styles.getPropertyValue(name).trim()]))
}

function resolveToken(value: string): string {
  const match = value.match(/^var\((--[\w-]+)\)$/)
  return match ? tokens.value[match[1]!] || value : value
}

function resolveTheme(value: unknown): unknown {
  if (typeof value === 'string') return resolveToken(value)
  if (Array.isArray(value)) return value.map(resolveTheme)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTheme(item)]))
  }
  return value
}

const themedOption = computed(() => ({
  textStyle: {
    fontFamily: tokens.value['--font-sans'] || 'sans-serif',
    fontSize: fontSize.value === 'large' ? 16 : fontSize.value === 'medium' ? 14 : 12,
  },
  ...(resolveTheme(props.option) as ChartOption),
}))

onMounted(() => {
  readTokens()
  themeObserver = new MutationObserver(readTokens)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-font-size'] })
})
onBeforeUnmount(() => themeObserver?.disconnect())
watch([mode, fontSize], () => { void nextTick(readTokens) }, { flush: 'post' })
</script>

<template>
  <div
    data-testid="chart-canvas"
    role="group"
    dir="ltr"
    :aria-label="accessibleLabel"
    class="min-w-0 w-full"
    :style="{ height }"
  >
    <VChart
      class="size-full"
      :option="themedOption"
      :init-options="initOptions"
      autoresize
    />
  </div>
</template>
