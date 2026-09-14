<script setup lang="ts">
import { governanceSections } from '@/composables/nav/governanceSections'
import { activeGovernanceSection } from '@/composables/nav/activeRoute'
import { routeTabClass, routeTabsStripClass } from '@/utils/sectionTabs'

const props = defineProps<{ projectId: number }>()

const route = useRoute()
const { t } = useI18n()
const sections = computed(() => governanceSections(props.projectId))
const current = computed(() => activeGovernanceSection(route.path))
</script>

<template>
  <nav
    :class="routeTabsStripClass"
    data-testid="project-governance-tabs"
    :aria-label="t('projects.workspace.subtabsLabel')"
  >
    <UButton
      v-for="section in sections"
      :key="section.id"
      color="neutral"
      variant="ghost"
      :class="routeTabClass"
      :to="section.to"
      :aria-current="current === section.id ? 'page' : undefined"
      :data-active="current === section.id"
      :data-testid="`governance-tab-${section.id}`"
    >
      <UIcon :name="section.icon" aria-hidden="true" class="size-4" />
      <span>{{ t(section.labelKey) }}</span>
    </UButton>
  </nav>
</template>
