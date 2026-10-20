<script setup lang="ts">
import { contextLinkTestId, type ShellContextSection } from '@/composables/nav/sidebarModel'

// The link rows of the context sidebar, one block per section; the fixed links card and the section pages card share them.
const props = defineProps<{
  sections: ShellContextSection[]
  counts: Record<string, number>
  expanded: boolean
  /** The id the count badges hang from, unique to the sidebar. */
  countPrefix: string
}>()
const { t } = useI18n()
const countId = (id: string) => `${props.countPrefix}-count-${id}`
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
</script>

<template>
  <div v-for="section in props.sections" :key="section.id" class="webvue-context-section">
    <h3 v-if="section.titleKey" class="webvue-context-section-title">{{ t(section.titleKey) }}</h3>
    <div v-for="link in section.links" :key="link.id" class="webvue-context-row">
      <UTooltip :text="t(link.labelKey)" :disabled="props.expanded">
        <UButton
          :to="link.to"
          color="neutral"
          variant="ghost"
          class="webvue-context-link"
          :data-active="link.active"
          :active="!!link.active"
          :aria-current="link.active ? 'page' : undefined"
          :aria-label="t(link.labelKey)"
          :aria-describedby="props.counts[link.id] !== undefined ? countId(link.id) : undefined"
          :data-testid="contextLinkTestId(link.id)"
        >
          <template #leading>
            <span class="webvue-context-chip" aria-hidden="true"><UIcon :name="link.icon" class="webvue-shell-icon size-4 shrink-0" /></span>
          </template>
          <span data-slot="label">{{ t(link.labelKey) }}</span>
        </UButton>
      </UTooltip>
      <span v-if="props.counts[link.id] !== undefined" :id="countId(link.id)" class="webvue-context-count">{{ countLabel(props.counts[link.id]!) }}</span>
    </div>
  </div>
</template>
