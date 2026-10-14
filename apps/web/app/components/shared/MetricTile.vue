<script setup lang="ts">
// One headline figure: a label, the value, and an optional hint or extra line
// (a progress bar, a badge). Used by dashboards, project summary and finance.
const props = defineProps<{
  label: string
  value: string | number | null | undefined
  icon?: `i-lucide-${string}`
  /** Unit shown after the value, e.g. "%". */
  unit?: string
  hint?: string
  /** `ltr` for numbers and unmarked dates; bidi-marked dates inherit the locale direction. */
  valueDir?: 'ltr' | 'rtl'
}>()
const { t } = useI18n()
const display = computed(() => props.value === null || props.value === undefined || props.value === '' ? t('app.notAvailable') : props.value)
const known = computed(() => display.value !== t('app.notAvailable'))
</script>

<template>
  <UCard :ui="{ body: 'flex items-start gap-4 p-5' }" data-testid="metric-tile">
    <span v-if="props.icon" class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated text-primary" aria-hidden="true">
      <UIcon :name="props.icon" class="size-5" />
    </span>
    <div class="grid min-w-0 flex-1 gap-1">
      <p class="text-sm text-muted">{{ props.label }}</p>
      <p class="wrap-anywhere text-2xl font-semibold tracking-tight text-highlighted tabular-nums" :dir="props.valueDir">
        {{ display }}<span v-if="known && props.unit" class="ms-1 text-sm font-normal tracking-normal text-muted">{{ props.unit }}</span>
      </p>
      <p v-if="props.hint" class="text-xs text-muted">{{ props.hint }}</p>
      <slot />
    </div>
  </UCard>
</template>
