<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// A destination tile: an icon in a 40px round chip, a title and an optional one-line description. The whole tile is
// the link (one focusable element), so it never nests another link or button. Hover lifts it 1px with a soft shadow and
// a primary ring; the focus ring is the same primary ring. The link is named by the title alone; the description is its accessible description. `tone` colours the chip like SharedMetricTile.
const TONE_CHIP = {
  primary: 'bg-primary/10 text-primary',
  neutral: 'bg-elevated text-muted',
  success: 'bg-status-success-soft text-status-success-foreground',
  warning: 'bg-status-warning-soft text-status-warning-foreground',
  danger: 'bg-status-danger-soft text-status-danger-foreground',
} as const
const props = withDefaults(defineProps<{
  to: RouteLocationRaw
  icon: `i-lucide-${string}`
  title: string
  description?: string
  tone?: keyof typeof TONE_CHIP
}>(), { tone: 'primary' })
const id = useId()
</script>

<template>
  <NuxtLink
    :to="props.to"
    data-slot="link-card"
    :data-tone="props.tone"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="props.description ? `${id}-description` : undefined"
    class="group flex min-w-0 items-center gap-3 rounded-card bg-default p-4 ring ring-default outline-none transition duration-150 hover:-translate-y-px hover:shadow-md hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
  >
    <span class="flex size-10 shrink-0 items-center justify-center rounded-full" :class="TONE_CHIP[props.tone]" aria-hidden="true">
      <UIcon :name="props.icon" class="size-5" />
    </span>
    <span class="grid min-w-0 flex-1 gap-0.5">
      <span :id="`${id}-title`" class="truncate text-sm font-semibold text-highlighted">{{ props.title }}</span>
      <span v-if="props.description" :id="`${id}-description`" class="truncate text-xs text-muted">{{ props.description }}</span>
    </span>
  </NuxtLink>
</template>
