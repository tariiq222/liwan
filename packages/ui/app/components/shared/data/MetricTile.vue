<script setup lang="ts">
// One headline figure: a label, the value, and an optional hint or extra line
// (a progress bar, a badge). Used by dashboards, project summary, finance and the task list's KPI strip.
// `density="compact"` is the slim strip tile (about 30% shorter: 12px/20px padding, a round 40px icon chip at the
// end); `progress` (0-100) adds a slim bar under the caption in the tone colour; `tone` colours the icon chip, and the danger tone also the figure. A tile is information, never a button.
const TONE_CHIP = {
  neutral: 'bg-elevated text-primary',
  warning: 'bg-status-warning-soft text-status-warning-foreground',
  danger: 'bg-status-danger-soft text-status-danger-foreground',
  success: 'bg-status-success-soft text-status-success-foreground',
} as const
const TONE_FILL = { neutral: 'bg-primary', warning: 'bg-warning', danger: 'bg-error', success: 'bg-success' } as const
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
}>(), { density: 'default', tone: 'neutral' })
const { t } = useI18n()
const display = computed(() => props.value === null || props.value === undefined || props.value === '' ? t('app.notAvailable') : props.value)
const known = computed(() => display.value !== t('app.notAvailable'))
const compact = computed(() => props.density === 'compact')
const progress = computed(() => props.progress === undefined || !Number.isFinite(props.progress) ? undefined : Math.min(100, Math.max(0, Math.round(props.progress))))
</script>

<template>
  <UCard :ui="{ body: compact ? 'flex items-center gap-3 px-(--webvue-card-pad) py-3.5' : 'flex items-start gap-4 p-5' }" data-testid="metric-tile" :data-density="props.density" :data-tone="props.tone">
    <span
      v-if="props.icon"
      class="flex shrink-0 items-center justify-center"
      :class="[TONE_CHIP[props.tone], compact ? 'order-last size-11.5 rounded-full' : 'size-10 rounded-md']"
      aria-hidden="true"
    >
      <UIcon :name="props.icon" class="size-5" />
    </span>
    <div class="grid min-w-0 flex-1" :class="compact ? 'gap-0' : 'gap-1'">
      <p :class="compact ? 'text-xs/4 font-semibold text-toned' : 'text-sm text-muted'">{{ props.label }}</p>
      <p
        class="wrap-anywhere font-semibold tracking-tight tabular-nums"
        :class="[compact ? 'text-2xl/8.5' : 'text-2xl', props.tone === 'danger' ? 'text-status-danger-foreground' : 'text-highlighted']"
        :dir="props.valueDir"
      >
        {{ display }}<span v-if="known && props.unit" class="ms-1 text-sm font-normal tracking-normal text-muted">{{ props.unit }}</span>
      </p>
      <p v-if="props.hint" class="text-xs text-muted">{{ props.hint }}</p>
      <div
        v-if="progress !== undefined"
        role="progressbar"
        :aria-label="props.label"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progress"
        class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--ui-border-muted)"
        data-slot="metric-progress"
      >
        <div class="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" :class="TONE_FILL[props.tone]" :style="{ width: `${progress}%` }" />
      </div>
      <slot />
    </div>
  </UCard>
</template>
