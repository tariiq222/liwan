<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import type { ShellNavigationLink, ShellQuickItem, ShellSubListSection } from '../../types/shell'
import ShellQuickRow from './ShellQuickRow.vue'

const props = defineProps<{
  label: string
  sections: ShellSubListSection[]
  collapsed: boolean
  /** `card` floats under the context sidebar; `drawer` is the flat block of the mobile drawer. */
  surface?: 'card' | 'drawer'
  testIdPrefix?: string
  openPath?: string[]
  hydrated?: boolean
}>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem]; disclose: [path: string[], open: boolean] }>()
const [DefineBranch, ReuseBranch] = createReusableTemplate<{ item: ShellNavigationLink; path: string[] }>()
const isOpen = (path: string[]) => path.length <= (props.openPath?.length ?? 0) && path.every((id, index) => props.openPath?.[index] === id)
const rowTestId = (item: ShellNavigationLink, path: string[]) => path.length === 1 ? item.testId : `${props.testIdPrefix ?? ''}${item.testId}`
</script>

<template>
  <DefineBranch v-slot="{ item, path }">
    <UCollapsible v-if="item.children?.length" class="webvue-submenu-branch" :open="isOpen(path)" :disabled="props.hydrated === false" @update:open="emit('disclose', path, $event)">
      <UButton type="button" color="neutral" variant="ghost" class="webvue-quick-link webvue-submenu-trigger w-full" :data-testid="rowTestId(item, path)" :aria-label="item.label" :aria-expanded="isOpen(path)" :disabled="props.hydrated === false">
        <template #leading><span class="webvue-quick-chip" aria-hidden="true"><UIcon :name="item.icon" class="webvue-shell-icon size-4 shrink-0" /></span></template>
        <span data-slot="label">{{ item.label }}</span>
        <template #trailing><UIcon name="i-lucide-chevron-down" class="webvue-navigation-chevron size-4 shrink-0" :class="{ 'rotate-180': isOpen(path) }" aria-hidden="true" /></template>
      </UButton>
      <template #content>
        <div class="webvue-navigation-submenu" :data-testid="`${props.testIdPrefix ?? ''}submenu-${path.join('-')}`">
          <ReuseBranch v-for="child in item.children" :key="child.id" :item="child" :path="[...path, child.id]" />
        </div>
      </template>
    </UCollapsible>
    <ShellQuickRow v-else :item="item" :test-id="rowTestId(item, path)" :collapsed="props.collapsed" @navigate="emit('navigate', $event)" />
  </DefineBranch>
  <aside v-if="props.sections.length" :data-testid="`${props.testIdPrefix ?? ''}context-sub-list`" class="webvue-quick-views webvue-sub-list" :data-expanded="!props.collapsed" :data-surface="props.surface ?? 'card'" :aria-label="props.label">
    <nav v-for="section in props.sections" :key="section.id" class="webvue-quick-group" data-fresh-navigation :aria-label="section.title || props.label" :data-testid="`${props.testIdPrefix ?? ''}context-sub-list-${section.id}`">
      <h3 v-if="section.title" class="webvue-sub-list-title">{{ section.title }}</h3>
      <ReuseBranch v-for="item in section.items" :key="item.id" :item="item" :path="[item.id]" />
    </nav>
  </aside>
</template>
