<script setup lang="ts">
// One headline figure: a label, the value, and an optional hint or extra line
// (a progress bar, a badge). Used by dashboards, project summary, finance and the task list's KPI strip.
// `density="compact"` is the slim strip tile (18px/20px padding, a 32px icon tile at the end: the application's own tile
// for the neutral tone, a soft status chip for the others, shown from `sm` up); `progress` (0-100) adds a slim SharedProgress under the caption in the tone colour; `tone` colours the icon chip, and the danger tone also the figure.
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
  /** Marks the tile as the currently active filter with a clear border. */
  active?: boolean
}>(), { density: 'default', tone: 'neutral', active: false })
const { t } = useI18n()
// A currency figure from Intl joins the amount and its code with a no-break space; in a tile the code may wrap under the amount.
const display = computed(() => props.value === null || props.value === undefined || props.value === ''
  ? t('app.notAvailable')
  : typeof props.value === 'string' ? props.value.replace(/\u00A0/g, ' ') : props.value)
const known = computed(() => display.value !== t('app.notAvailable'))
const compact = computed(() => props.density === 'compact')
const chip = computed(() => props.emphasis && props.tone === 'neutral' ? 'bg-primary/10 text-primary' : TONE_CHIP[props.tone])
// On a phone two compact tiles share a row: the figure drops a step and the icon circle steps aside, so a long amount stays whole inside its tile.
const figureSize = computed(() => props.emphasis ? 'text-[length:calc(var(--liwan-fs-figure)*1.2)]/[1.2]' : 'text-(length:--liwan-fs-figure)/[1.2]')
// The neutral tone of a compact tile is the application's tile (ink for a free application); the status tones stay soft chips.
const appTile = computed(() => compact.value && props.tone === 'neutral' && !props.emphasis)
</script>

<template>
  <UCard
    :class="{ 'liwan-lift relative': props.to, 'h-full': compact, 'ring-2 ring-primary bg-primary/[0.03]': props.active }"
    :ui="{ body: compact ? 'flex h-full w-full min-w-0 flex-col justify-between gap-2 px-(--liwan-card-pad-dense) py-3.5 sm:px-(--liwan-card-pad-dense) sm:py-3.5' : 'flex items-start gap-4 p-5 sm:p-5' }"
    data-testid="metric-tile"
    :data-density="props.density"
    :data-tone="props.tone"
    :data-emphasis="props.emphasis || undefined"
    :data-active="props.active ? 'true' : undefined"
  >
    <template v-if="compact">
      <div class="flex h-full w-full min-w-0 flex-col justify-between gap-2">
        <div class="flex min-w-0 items-center justify-between gap-3">
          <p class="min-w-0 text-(length:--liwan-fs-small-label)/5 text-muted">{{ props.label }}</p>
          <span
            v-if="props.icon"
            class="hidden shrink-0 items-center justify-center sm:flex"
            aria-hidden="true"
          >
            <span :class="[appTile ? 'liwan-app-tile liwan-app-tile-md' : ['flex size-8 items-center justify-center rounded-control', chip]]">
              <UIcon :name="props.icon" class="size-4" />
            </span>
          </span>
        </div>
        <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p
            class="w-fit max-w-full wrap-break-word font-bold tracking-[-0.02em] tabular-nums"
            :class="['font-display', figureSize, props.tone === 'danger' ? 'text-status-danger-foreground' : 'text-highlighted']"
            :dir="props.valueDir"
          >
            {{ display }}<span v-if="known && props.unit" class="ms-1 text-sm font-normal tracking-normal text-muted">{{ props.unit }}</span>
          </p>
          <p v-if="props.hint && props.progress === undefined" class="min-w-0 truncate text-xs text-muted">{{ props.hint }}</p>
        </div>
        <p v-if="props.hint && props.progress !== undefined" class="truncate text-xs text-muted">{{ props.hint }}</p>
        <SharedProgress v-if="props.progress !== undefined" class="mt-0.5" :value="props.progress" :tone="PROGRESS_TONE[props.tone]" :label="props.label" data-slot="metric-progress" />
        <slot />
      </div>
    </template>
    <template v-else>
      <span
        v-if="props.icon"
        class="flex shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <span :class="['flex size-10 items-center justify-center rounded-control', chip]">
          <UIcon :name="props.icon" class="size-5" />
        </span>
      </span>
      <div class="grid min-w-0 flex-1 gap-1">
        <p class="text-(length:--liwan-fs-small-label)/5 text-muted">{{ props.label }}</p>
        <p
          class="w-fit max-w-full justify-self-start wrap-break-word font-bold tracking-[-0.02em] tabular-nums"
          :class="['font-display', figureSize, props.tone === 'danger' ? 'text-status-danger-foreground' : 'text-highlighted']"
          :dir="props.valueDir"
        >
          {{ display }}<span v-if="known && props.unit" class="ms-1 text-sm font-normal tracking-normal text-muted">{{ props.unit }}</span>
        </p>
        <p v-if="props.hint" class="text-xs text-muted">{{ props.hint }}</p>
        <SharedProgress v-if="props.progress !== undefined" class="mt-1.5" :value="props.progress" :tone="PROGRESS_TONE[props.tone]" :label="props.label" data-slot="metric-progress" />
        <slot />
      </div>
    </template>
    <NuxtLink
      v-if="props.to"
      :to="props.to"
      :aria-label="`${props.label}: ${display}`"
      :aria-current="props.active ? 'true' : undefined"
      data-slot="metric-link"
      class="absolute inset-0 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    />
  </UCard>
</template>
