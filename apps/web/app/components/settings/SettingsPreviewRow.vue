<script setup lang="ts">
import type { SettingsPreviewItem } from '@/utils/settingsPreview'

// One row of a settings preview card: a chip (a person's avatar or an icon), the name, one muted line and at most one
// status pill. A preview is a compact list, not a table, so it fits any width without scrolling.
defineProps<{ item: SettingsPreviewItem }>()
</script>

<template>
  <NuxtLink :to="item.to" class="flex min-w-0 items-center gap-3 px-(--webvue-card-pad) py-3 transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none" data-testid="settings-preview-row">
    <SharedPersonAvatar v-if="item.person" :people="[item.person]" />
    <span v-else-if="item.icon" class="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true"><UIcon :name="item.icon" class="size-4" /></span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold text-highlighted">{{ item.name }}</span>
      <span v-if="item.secondary" class="block truncate text-xs text-muted">{{ item.secondary }}</span>
    </span>
    <SharedStatusBadge v-if="item.badge" class="shrink-0" size="sm" :tone="item.badge.tone" :label="item.badge.label" />
  </NuxtLink>
</template>
