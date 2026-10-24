<script setup lang="ts">
import type { ShellQuickItem, ShellSubListSection } from '../../types/shell'
import ShellQuickRow from './ShellQuickRow.vue'

// The section sub-list card under the context sidebar: the open section's titled link runs, one group per title.
// Props only; the shell rule applies to every application (DESIGN.md). It folds to the same 64px icon-only bar as the
// context sidebar: headings drop out, rows keep a tooltip and their name.
const props = defineProps<{
  label: string
  sections: ShellSubListSection[]
  collapsed: boolean
  /** `card` floats under the context sidebar; `drawer` is the flat block of the mobile drawer. */
  surface?: 'card' | 'drawer'
  testIdPrefix?: string
}>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem] }>()
</script>

<template>
  <aside v-if="props.sections.length" :data-testid="`${props.testIdPrefix ?? ''}context-sub-list`" class="webvue-quick-views webvue-sub-list" :data-expanded="!props.collapsed" :data-surface="props.surface ?? 'card'" :aria-label="props.label">
    <nav v-for="section in props.sections" :key="section.id" class="webvue-quick-group" data-fresh-navigation :aria-label="section.title || props.label" :data-testid="`${props.testIdPrefix ?? ''}context-sub-list-${section.id}`">
      <h3 v-if="section.title" class="webvue-sub-list-title">{{ section.title }}</h3>
      <ShellQuickRow v-for="item in section.items" :key="item.id" :item="item" :test-id="item.testId" :collapsed="props.collapsed" @navigate="emit('navigate', $event)" />
    </nav>
  </aside>
</template>
