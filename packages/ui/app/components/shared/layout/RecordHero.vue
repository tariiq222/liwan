<script setup lang="ts">
/*
 * Record hero (DESIGN.md §5): the record's primary identity block above its tabs, with an optional icon chip,
 * tone-tinted surface, title line, muted meta line, top-end actions, and a default slot that takes one or more
 * compact metric tiles (1–2 recommended) while the hero card keeps 2fr.
 */
type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const TONE_SURFACE: Record<Tone, string> = {
  info: 'from-info/10 via-info/[0.03] to-default ring ring-info/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-info/15 dark:via-info/5 dark:to-default',
  success: 'from-success/10 via-success/[0.03] to-default ring ring-success/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-success/15 dark:via-success/5 dark:to-default',
  warning: 'from-warning/10 via-warning/[0.03] to-default ring ring-warning/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-warning/15 dark:via-warning/5 dark:to-default',
  danger: 'from-error/10 via-error/[0.03] to-default ring ring-error/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-error/15 dark:via-error/5 dark:to-default',
  neutral: 'bg-elevated/40 ring ring-default',
}

const TONE_CHIP: Record<Tone, string> = {
  info: 'bg-info/15 text-status-info-foreground',
  success: 'bg-status-success-soft text-status-success-foreground',
  warning: 'bg-status-warning-soft text-status-warning-foreground',
  danger: 'bg-status-danger-soft text-status-danger-foreground',
  neutral: 'bg-elevated text-muted',
}

const props = withDefaults(defineProps<{
  icon?: `i-lucide-${string}`
  tone?: Tone
}>(), { tone: 'neutral' })

defineSlots<{
  title?: () => unknown
  meta?: () => unknown
  actions?: () => unknown
  default?: () => unknown
}>()
</script>

<template>
  <div
    data-slot="record-hero"
    :data-tone="props.tone"
    :class="$slots.default ? 'grid min-w-0 gap-(--liwan-gap-card) lg:grid-flow-col lg:grid-cols-[minmax(0,2fr)] lg:auto-cols-[minmax(0,1fr)]' : 'min-w-0'"
  >
    <div :class="['flex flex-col justify-between gap-3 rounded-card px-(--liwan-card-pad) py-4', TONE_SURFACE[props.tone]]">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <span
            v-if="props.icon"
            :class="['hidden size-10 shrink-0 place-items-center rounded-control sm:grid', TONE_CHIP[props.tone]]"
            aria-hidden="true"
          >
            <UIcon :name="props.icon" class="size-5" />
          </span>
          <div v-if="$slots.title" class="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-lg font-bold text-highlighted">
            <slot name="title" />
          </div>
        </div>
        <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
      <div v-if="$slots.meta" class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
        <slot name="meta" />
      </div>
    </div>
    <slot />
  </div>
</template>
