<script setup lang="ts">
import { avatarProps } from '../../../utils/avatarTone'

// The identity hero of a person or unit record (employee, department, user): avatar, name, a status pill and one
// sub-line in a single panel card. Every such record opens with it, so they read the same; the facts go in the
// aside's properties panel. The sub-line is the `subtitle` text, or the `#subtitle` slot when it needs markup.
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
        <p v-if="subtitle || $slots.subtitle" class="truncate text-sm text-muted">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>
    </div>
  </SharedRecordSection>
</template>
