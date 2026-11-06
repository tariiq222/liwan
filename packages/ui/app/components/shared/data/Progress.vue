<script setup lang="ts">
// The one progress bar (a UProgress wrapper): a slim pill filled in a tone colour, 0-100 clamped. `sm` is 6px (KPI tiles,
// table cells) and `md` 8px (a record's headline progress). The fill animates over 300ms and not at all under reduced motion
// (the progress recipe in app.config.ts). With `label` the bar is a named group and the screen reader reads "label, N%".
// Every tone keeps its colour at 100%. Between 0 and 100 a small Sadu triangle in the tone colour marks the leading
// edge of the fill and points the way it grows (inline-end, so it flips in RTL); it is decorative.
const TONE = {
  primary: { color: 'primary', complete: '', head: 'text-primary' },
  success: { color: 'success', complete: 'data-[state=complete]:bg-success', head: 'text-success' },
  warning: { color: 'warning', complete: 'data-[state=complete]:bg-warning', head: 'text-warning' },
  danger: { color: 'error', complete: 'data-[state=complete]:bg-error', head: 'text-error' },
  neutral: { color: 'neutral', complete: 'data-[state=complete]:bg-inverted', head: 'text-inverted' },
} as const
const HEAD = { sm: { class: 'h-2.5 w-2', offset: '4px' }, md: { class: 'h-3 w-2.5', offset: '5px' } } as const
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
const showHead = computed(() => percent.value !== undefined && percent.value > 0 && percent.value < 100)
</script>

<template>
  <div v-if="percent !== undefined" data-slot="progress" class="relative" :data-size="props.size" :data-tone="props.tone" :role="props.label ? 'group' : undefined" :aria-label="props.label">
    <UProgress :model-value="percent" :size="props.size" :color="toneClasses.color" :ui="{ indicator: toneClasses.complete }" />
    <svg
      v-if="showHead"
      data-slot="progress-head"
      viewBox="0 0 8 10"
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 -translate-y-1/2 rtl:-scale-x-100"
      :class="[HEAD[props.size].class, toneClasses.head]"
      :style="{ insetInlineStart: `calc(${percent}% - ${HEAD[props.size].offset})` }"
    ><path d="M0 0 8 5 0 10Z" fill="currentColor" /></svg>
  </div>
</template>
