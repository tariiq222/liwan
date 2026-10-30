<script setup lang="ts">
import type { ShellQuickItem } from '../../types/shell'

// One link row of the shell cards (quick views, actions, the section sub-list): chip, label, optional count.
// Folded to an icon-only row, it keeps its title as a tooltip and an accessible name.
const props = defineProps<{ item: ShellQuickItem; testId: string; collapsed: boolean; action?: boolean }>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem] }>()
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
</script>

<template>
  <div class="liwan-quick-row">
    <UTooltip :text="props.item.label" :disabled="!props.collapsed">
      <UButton
        :to="props.item.to"
        color="neutral"
        variant="ghost"
        class="liwan-quick-link"
        :class="{ 'liwan-quick-action': props.action }"
        :data-primary="props.item.primary ? 'true' : undefined"
        :data-active="props.item.active"
        :active="!!props.item.active"
        :aria-current="props.item.active ? 'true' : undefined"
        :aria-label="props.item.label"
        :data-testid="props.testId"
        @click="emit('navigate', props.item)"
      >
        <template #leading>
          <span class="liwan-quick-chip" aria-hidden="true"><UIcon :name="props.item.icon" class="liwan-shell-icon size-4 shrink-0" /></span>
        </template>
        <span data-slot="label">{{ props.item.label }}</span>
      </UButton>
    </UTooltip>
    <span v-if="props.item.count !== undefined" class="liwan-quick-count">{{ countLabel(props.item.count) }}</span>
  </div>
</template>
