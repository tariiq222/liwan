<script setup lang="ts">
import { governanceSections } from '@/composables/nav/governanceSections'
import { planningSections, projectSections } from '@/composables/nav/projectSections'
import { activeGovernanceSection, activePlanningSection, activeProjectSection } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import { projectSectionLocation } from '@/utils/projectWorkspaceMemory'

// The project workspace's tab strips (Tasmim spec §6 merge). `sections` is the main strip; `governance` is the
// sub-strip on the canvas under the frame band on every governance page, in the same underline look. Both are route tabs and keep their own test ids.
const props = withDefaults(defineProps<{
  projectId: number
  active?: boolean
  level?: 'sections' | 'governance' | 'planning'
}>(), { level: 'sections' })

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const projectId = computed(() => Number.isInteger(props.projectId) && props.projectId > 0 ? props.projectId : null)
const projectQuery = useProject(projectId)
// Server and first client render must produce the same tab set.
const projectData = computed(() => hydrated.value ? projectQuery.data.value : undefined)
const activeProject = computed(() => props.active ?? projectData.value?.active ?? true)
const sectionItems = computed(() => {
  const current = activeProjectSection(route.path)
  return projectSections(props.projectId, me.value, { active: activeProject.value }).map(section => ({
    key: `project-tab-${section.id}`, label: t(section.labelKey), to: projectSectionLocation(section.to, route.path, route.query), active: current === section.id, icon: section.icon,
  }))
})
const governanceItems = computed(() => {
  const current = activeGovernanceSection(route.path)
  return governanceSections(props.projectId).map(section => ({
    key: `governance-tab-${section.id}`, label: t(section.labelKey), to: projectSectionLocation(section.to, route.path, route.query), active: current === section.id, icon: section.icon,
  }))
})
const planningItems = computed(() => planningSections(props.projectId, { active: activeProject.value }).map(section => ({
  key: `planning-tab-${section.id}`, label: t(section.labelKey), to: projectSectionLocation(section.to, route.path, route.query), active: activePlanningSection(route.path) === section.id, icon: section.icon,
})))
const sublevel = computed(() => props.level !== 'sections')
const governance = computed(() => props.level === 'governance')
</script>

<template>
  <SharedRouteTabs
    :items="governance ? governanceItems : props.level === 'planning' ? planningItems : sectionItems"
    :ariaLabel="t(sublevel ? 'projects.workspace.subtabsLabel' : 'projects.workspace.tabsLabel')"
    :class="['[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', sublevel ? '' : '-mb-px border-b-0!']"
    :data-testid="governance ? 'project-governance-tabs' : props.level === 'planning' ? 'project-planning-tabs' : 'project-workspace-tabs'"
  />
</template>
