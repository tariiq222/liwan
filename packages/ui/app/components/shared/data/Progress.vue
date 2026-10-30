<script setup lang="ts">
// The one progress bar (a UProgress wrapper): a slim pill filled in a tone colour, 0-100 clamped. `sm` is 6px (KPI tiles,
// table cells) and `md` 8px (a record's headline progress). The fill animates over 300ms and not at all under reduced motion
// (the progress recipe in app.config.ts). With `label` the bar is a named group and the screen reader reads "label, N%".
// Every tone keeps its colour at 100%.
const TONE = {
  primary: { color: 'primary', complete: '' },
  success: { color: 'success', complete: 'data-[state=complete]:bg-success' },
  warning: { color: 'warning', complete: 'data-[state=complete]:bg-warning' },
  danger: { color: 'error', complete: 'data-[state=complete]:bg-error' },
  neutral: { color: 'neutral', complete: 'data-[state=complete]:bg-inverted' },
} as const
const props = withDefaults(defineProps<{
  /** 0-100; clamped, and the bar is not drawn when it is not a number. */
  value: number | null | undefined
  size?: 'sm' | 'md'
  tone?: keyof typeof TONE
  /** Names the bar for assistive technology. */
  label?: string
}>(), { size: 'sm', tone: 'primary' })
const percent = computed(() => props.value === null || props.value === undefined || !Number.isFinite(props.value) ? undefined : Math.min(100, Math.max(0, Math.round(props.value))))
const toneClasses = computed(() => TONE[props.tone])
</script>

<template>
  <div v-if="percent !== undefined" data-slot="progress" :data-size="props.size" :data-tone="props.tone" :role="props.label ? 'group' : undefined" :aria-label="props.label">
    <UProgress :model-value="percent" :size="props.size" :color="toneClasses.color" :ui="{ indicator: toneClasses.complete }" />
  </div>
</template>
