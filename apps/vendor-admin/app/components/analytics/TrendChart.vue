<script setup lang="ts">
// Monthly recurring revenue over the last twelve months as an area line. Plain SVG on the design tokens, so it
// follows light and dark mode; the time axis runs right to left in Arabic. A hidden table carries the same numbers for screen readers.
// A month with no figure (`minor` null) is a gap in the line, never a zero.
export interface TrendPoint { month: string, minor: number | null, label: string }
const props = defineProps<{ points: readonly TrendPoint[], axisLabel: (minor: number) => string, title: string }>()
const { t, locale } = useI18n()
const rtl = computed(() => locale.value.startsWith('ar'))
const H = 240, PAD_TOP = 22, PAD_BOTTOM = 34, PAD_X = 30, TICKS = 3, FALLBACK_WIDTH = 640, MIN_WIDTH = 280, LABEL_MIN_STEP = 52
const holder = useTemplateRef<HTMLElement>('holder')
const { width: measured } = useElementSize(holder)
// The SVG is drawn in real pixels so text keeps its size on a phone and the chart keeps its height on a wide screen.
const W = computed(() => Math.max(MIN_WIDTH, measured.value || FALLBACK_WIDTH))
const top = computed(() => Math.max(1, ...props.points.map(point => point.minor ?? 0)))
const step = computed(() => (props.points.length > 1 ? (W.value - PAD_X * 2) / (props.points.length - 1) : 0))
const xOf = (index: number) => (rtl.value ? W.value - PAD_X - index * step.value : PAD_X + index * step.value)
const yOf = (minor: number) => PAD_TOP + (1 - minor / top.value) * (H - PAD_TOP - PAD_BOTTOM)
const coords = computed(() => props.points.map((point, index) => ({ x: xOf(index), y: point.minor === null ? null : yOf(point.minor), point })))
type Plotted = { x: number, y: number, point: TrendPoint }
// Runs of consecutive months that have a figure; each is drawn as its own line and area.
const runs = computed(() => {
  const found: Plotted[][] = []
  let open = false
  for (const c of coords.value) {
    if (c.y === null) { open = false; continue }
    if (!open) found.push([])
    found.at(-1)!.push({ x: c.x, y: c.y, point: c.point })
    open = true
  }
  return found.map(run => ({
    line: run.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '),
    area: `${run[0]!.x},${H - PAD_BOTTOM} ${run.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')} ${run.at(-1)!.x},${H - PAD_BOTTOM}`,
  }))
})
const ticks = computed(() => Array.from({ length: TICKS + 1 }, (_, i) => ({ y: yOf((top.value * i) / TICKS), text: props.axisLabel(Math.round((top.value * i) / TICKS)) })))
</script>

<template>
  <figure ref="holder" class="min-w-0" data-testid="analytics-trend">
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" class="block max-w-full" role="img" :aria-label="props.title">
      <g v-for="tick in ticks" :key="tick.y">
        <line :x1="PAD_X" :x2="W - PAD_X" :y1="tick.y" :y2="tick.y" stroke="var(--ui-border)" stroke-width="1" />
        <text :x="rtl ? W - PAD_X : PAD_X" :y="tick.y - 5" :text-anchor="rtl ? 'end' : 'start'" direction="ltr" font-size="11" fill="var(--ui-text-muted)">{{ tick.text }}</text>
      </g>
      <g v-for="run in runs" :key="run.line">
        <polygon :points="run.area" fill="var(--ui-primary)" fill-opacity="0.14" />
        <polyline :points="run.line" fill="none" stroke="var(--ui-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      </g>
      <g v-for="(c, i) in coords" :key="c.point.month">
        <circle v-if="c.y !== null && c.point.minor !== null" :cx="c.x" :cy="c.y" r="3.5" fill="var(--ui-bg)" stroke="var(--ui-primary)" stroke-width="2"><title>{{ c.point.label }}: {{ props.axisLabel(c.point.minor) }}</title></circle>
        <text v-if="step >= LABEL_MIN_STEP || i % 2 === 0" :x="c.x" :y="H - 12" text-anchor="middle" font-size="11" fill="var(--ui-text-muted)">{{ c.point.label }}</text>
      </g>
    </svg>
    <table class="sr-only">
      <caption>{{ props.title }}</caption>
      <tbody><tr v-for="point in props.points" :key="point.month"><th scope="row">{{ point.label }}</th><td>{{ point.minor === null ? t('analytics.unavailable.short') : props.axisLabel(point.minor) }}</td></tr></tbody>
    </table>
  </figure>
</template>
