<script setup lang="ts">
import { MARK_ARCHES, MARK_DIAMOND_SOLID, MARK_TRIANGLES } from '../../../utils/brandMark'

// The small loading indicator of the LiwanOS Sadu identity, for small places (a card body, a side panel, the
// assistant). Pages and lists keep LoadingSkeleton. `mark`: the logo's courtyard with its four Sadu triangles lighting
// in turn, clockwise; `dots`: five Sadu dots lighting in sequence, inline beside text. Announced once with `label`
// (app.loading by default); under reduced motion it stands still.
const props = withDefaults(defineProps<{ variant?: 'mark' | 'dots', label?: string }>(), { variant: 'mark' })
const { t } = useI18n()
const DOTS = [0, 1, 2, 3, 4] as const
const TRIANGLE_STEP_MS = 400
const DOT_STEP_MS = 150
</script>

<template>
  <span role="status" :aria-label="props.label ?? t('app.loading')" data-slot="sadu-loader" :data-variant="props.variant" class="inline-flex items-center text-primary">
    <svg v-if="props.variant === 'mark'" viewBox="-2 -2 68 68" class="size-10" aria-hidden="true">
      <path :d="MARK_ARCHES" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" />
      <path :d="MARK_DIAMOND_SOLID" fill="currentColor" />
      <path v-for="(triangle, index) in MARK_TRIANGLES" :key="index" :d="triangle" fill="currentColor" class="liwan-sadu-lit" :style="{ animationDelay: `${index * TRIANGLE_STEP_MS}ms` }" />
    </svg>
    <svg v-else viewBox="0 0 70 14" class="h-2.5 w-[50px]" aria-hidden="true">
      <rect v-for="dot in DOTS" :key="dot" :x="dot * 14 + 3.5" y="3.5" width="7" height="7" :transform="`rotate(45 ${dot * 14 + 7} 7)`" fill="currentColor" class="liwan-sadu-pulse" :style="{ animationDelay: `${dot * DOT_STEP_MS}ms` }" />
    </svg>
  </span>
</template>
