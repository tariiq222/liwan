<script setup lang="ts">
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'

// The identity hero of an HR record (employee, department): avatar, name, a status pill and one sub-line in a single
// card. Both records open with it, so they read the same; the facts go in the aside's properties panel.
defineProps<{ id: number; name: string; subtitle?: string }>()
</script>

<template>
  <SharedRecordSection variant="panel" data-slot="identity-card">
    <div class="flex items-center gap-4">
      <UAvatar v-bind="avatarProps(name, id)" size="xl" />
      <div class="min-w-0 flex-1 space-y-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <p class="truncate text-base font-semibold text-highlighted">{{ name }}</p>
          <slot name="badge" />
        </div>
        <p v-if="subtitle" class="truncate text-sm text-muted">{{ subtitle }}</p>
      </div>
    </div>
  </SharedRecordSection>
</template>
