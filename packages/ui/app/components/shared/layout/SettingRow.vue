<script setup lang="ts">
/*
 * One setting (DESIGN.md §6, settings pages): the name and its one-line description on the start side (about 60
 * characters wide), the control on the end side, centred on the row; on a phone the control drops under the text. When the
 * setting is disabled for a reason of its own, `disabledReason` says why inline, with an optional link to the dependency
 * that enables it. The control is the default slot: a toggle with a positive label, a segmented control for two or three
 * short options, or `SharedOptionCards` (the `stacked` layout) when each option needs an explanation.
 */
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  label: string
  description?: string
  /** Why the control is disabled, shown under the description. */
  disabledReason?: string
  /** A link to the setting that has to be turned on first (on the same page: a hash link). */
  disabledLink?: { to: RouteLocationRaw; label: string }
  /** Options with explanations go under the text, full width, instead of on the end side. */
  stacked?: boolean
}>()
const id = useId()
</script>

<template>
  <div class="liwan-setting-row" :data-stacked="props.stacked ? 'true' : undefined" role="group" :aria-labelledby="`${id}-label`" data-slot="setting-row">
    <div class="liwan-setting-row-text">
      <p :id="`${id}-label`" class="text-sm font-medium text-highlighted">{{ props.label }}</p>
      <p v-if="props.description" class="mt-0.5 text-[0.8125rem] leading-5 text-muted">{{ props.description }}</p>
      <p v-if="props.disabledReason" class="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] leading-5 text-status-warning-foreground" data-slot="setting-row-reason">
        <UIcon name="i-lucide-info" aria-hidden="true" class="mt-0.5 size-4 shrink-0" />
        <span>
          {{ props.disabledReason }}
          <NuxtLink v-if="props.disabledLink" :to="props.disabledLink.to" class="font-medium underline underline-offset-2">{{ props.disabledLink.label }}</NuxtLink>
        </span>
      </p>
    </div>
    <div class="liwan-setting-row-control"><slot /></div>
  </div>
</template>
