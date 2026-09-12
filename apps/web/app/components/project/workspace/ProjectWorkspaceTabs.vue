<script setup lang="ts">
import { projectSections } from '@/composables/nav/projectSections'
import { activeProjectSection } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'

const props = defineProps<{
  projectId: number
  active?: boolean
}>()

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const projectId = computed(() => Number.isInteger(props.projectId) && props.projectId > 0 ? props.projectId : null)
const projectQuery = useProject(projectId)
// Server and first client render must produce the same tab set.
const projectData = computed(() => hydrated.value ? projectQuery.data.value : undefined)
const activeProject = computed(() => props.active ?? projectData.value?.active ?? true)
const sections = computed(() => projectSections(props.projectId, me.value, { active: activeProject.value }))
const current = computed(() => activeProjectSection(route.path))
</script>

<template>
  <nav
    v-if="sections.length"
    class="nasq-ui-tab-strip"
    data-testid="project-workspace-tabs"
    :aria-label="t('projects.workspace.tabsLabel')"
  >
    <UButton
      v-for="section in sections"
      :key="section.id"
      color="neutral"
      variant="ghost"
      class="nasq-ui-tab"
      :to="section.to"
      :aria-current="current === section.id ? 'page' : undefined"
      :data-active="current === section.id"
      :data-testid="`project-tab-${section.id}`"
    >
      <UIcon :name="section.icon" aria-hidden="true" class="size-4" />
      <span>{{ t(section.labelKey) }}</span>
    </UButton>
  </nav>
</template>
