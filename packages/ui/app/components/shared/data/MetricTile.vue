<script setup lang="ts">
// One headline figure: a label, the value, and an optional hint or extra line
// (a progress bar, a badge). Used by dashboards, project summary, finance and the task list's KPI strip.
// `density="compact"` is the slim strip tile (about 30% shorter: 12px/20px padding, a round 40px icon chip at the
// end); `progress` (0-100) adds a slim SharedProgress under the caption in the tone colour; `tone` colours the icon chip, and the danger tone also the figure.
// `emphasis` is the page's headline figure: a larger number and a brand-tinted icon chip. `to` makes the whole tile a link
// (a stretched link with its own focus ring); without it a tile is information, never a button.
const TONE_CHIP = {
  neutral: 'bg-elevated text-primary',
  warning: 'bg-status-warning-soft text-status-warning-foreground',
  danger: 'bg-status-danger-soft text-status-danger-foreground',
  success: 'bg-status-success-soft text-status-success-foreground',
} as const
const PROGRESS_TONE = { neutral: 'primary', warning: 'warning', danger: 'danger', success: 'success' } as const
const props = withDefaults(defineProps<{
  label: string
  value: string | number | null | undefined
  icon?: `i-lucide-${string}`
  /** Unit shown after the value, e.g. "%". */
  unit?: string
  hint?: string
  /** `ltr` for numbers and unmarked dates; bidi-marked dates inherit the locale direction. */
  valueDir?: 'ltr' | 'rtl'
  density?: 'default' | 'compact'
  tone?: keyof typeof TONE_CHIP
  /** 0-100: a slim bar under the caption in the tone colour; clamped, and hidden when undefined. */
  progress?: number
  /** A larger figure and a brand-tinted chip for the page's headline number. */
  emphasis?: boolean
  /** Makes the tile a link to this route. */
  to?: string
}>(), { density: 'default', tone: 'neutral' })
const { t } = useI18n()
const display = computed(() => props.value === null || props.value === undefined || props.value === '' ? t('app.notAvailable') : props.value)
const known = computed(() => display.value !== t('app.notAvailable'))
const compact = computed(() => props.density === 'compact')
const chip = computed(() => props.emphasis && props.tone === 'neutral' ? 'bg-primary/10 text-primary' : TONE_CHIP[props.tone])
// On a phone two compact tiles share a row: the figure drops a step and the icon circle steps aside, so a long amount stays whole inside its tile.
const figureSize = computed(() => props.emphasis ? 'text-3xl/10' : compact.value ? 'text-xl/7 sm:text-2xl/8.5' : 'text-2xl')
</script>

<template>
  <UCard
    :class="{ 'relative transition-colors duration-150 hover:bg-(--webvue-row-hover) motion-reduce:transition-none': props.to }"
    :ui="{ body: compact ? 'flex items-center gap-3 px-(--webvue-card-pad) py-3.5' : 'flex items-start gap-4 p-5' }"
    data-testid="metric-tile"
    :data-density="props.density"
    :data-tone="props.tone"
    :data-emphasis="props.emphasis || undefined"
  >
    <span
      v-if="props.icon"
      class="flex shrink-0 items-center justify-center"
      :class="[chip, compact ? 'order-last hidden size-11.5 rounded-full sm:flex' : 'size-10 rounded-full']"
      aria-hidden="true"
    >
      <UIcon :name="props.icon" class="size-5" />
    </span>
    <div class="grid min-w-0 flex-1" :class="compact ? 'gap-0' : 'gap-1'">
      <p :class="compact ? 'text-xs/4 font-semibold text-toned' : 'text-sm text-muted'">{{ props.label }}</p>
      <p
        class="wrap-break-word font-semibold tracking-tight tabular-nums"
        :class="[figureSize, props.tone === 'danger' ? 'text-status-danger-foreground' : 'text-highlighted']"
        :dir="props.valueDir"
      >
        {{ display }}<span v-if="known && props.unit" class="ms-1 text-sm font-normal tracking-normal text-muted">{{ props.unit }}</span>
      </p>
      <p v-if="props.hint" class="text-xs text-muted">{{ props.hint }}</p>
      <SharedProgress v-if="props.progress !== undefined" class="mt-1.5" :value="props.progress" :tone="PROGRESS_TONE[props.tone]" :label="props.label" data-slot="metric-progress" />
      <slot />
    </div>
    <NuxtLink
      v-if="props.to"
      :to="props.to"
      :aria-label="`${props.label}: ${display}`"
      data-slot="metric-link"
      class="absolute inset-0 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    />
  </UCard>
</template>
