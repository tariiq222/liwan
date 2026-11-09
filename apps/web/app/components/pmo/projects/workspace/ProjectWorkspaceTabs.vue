<script setup lang="ts">
import { hasFeature } from '@/modules/registry'
import { governanceSections } from '@/modules/pmo/governanceSections'
import { planningSections, projectSections } from '@/modules/pmo/projectSections'
import { activeGovernanceSection, activePlanningSection, activeProjectSection } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'
import { projectSectionLocation } from '@/utils/projectWorkspaceMemory'

// The project workspace's tab strips (Tasmim spec §6 merge). `sections` is the main strip; `governance`, `planning` (milestones and
// baselines) and `finance` are the sub-strips under the header's divider, as pill strips. All are route tabs and keep their own test ids.
const props = withDefaults(defineProps<{
  projectId: number
  active?: boolean
  level?: 'sections' | 'governance' | 'planning' | 'finance'
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
// Five tabs: summary, tasks, meetings (with `meetings.read`), finance, governance. Updates are part of the summary and the timeline is a view of the tasks.
const sectionItems = computed(() => {
  const current = activeProjectSection(route.path)
  return projectSections(props.projectId, me.value, { active: activeProject.value, tools: projectData.value?.tools }).map(section => ({
    key: `project-tab-${section.id}`, label: t(section.labelKey), to: projectSectionLocation(section.to, route.path, route.query), active: current === section.id, icon: section.icon,
  }))
})
const governanceItems = computed(() => {
  const current = activeGovernanceSection(route.path)
  return governanceSections(props.projectId, { changeControl: (projectData.value?.change_control_mode ?? 'off') !== 'off' && hasFeature(me.value, 'pmo.change_control') }).map(section => ({
    key: `governance-tab-${section.id}`, label: t(section.labelKey), to: projectSectionLocation(section.to, route.path, route.query), active: current === section.id, icon: section.icon,
  }))
})
// The timeline is a view of the tasks, so its link opens the task list on that view, keeping the saved task filters and the list the
// reader came from (the section location carries them); the other two keep their own pages.
const withView = (location: ReturnType<typeof projectSectionLocation>, view?: Record<string, string>) => (view ? { path: location.path, query: { ...location.query, ...view } } : location)
const planningItems = computed(() => planningSections(props.projectId, { active: activeProject.value, baselines: hasFeature(me.value, 'pmo.baselines') }).map(({ to, query, ...section }) => ({
  key: `planning-tab-${section.id}`, label: t(section.labelKey), to: withView(projectSectionLocation(to, route.path, route.query), query), active: activePlanningSection(route.path) === section.id, icon: section.icon,
})))

const financeItems = computed(() => [{key:'finance-tab-overview',label:t('nav.projectFinance'),to:`/projects/${props.projectId}/finance`,active:route.path === `/projects/${props.projectId}/finance`}, ...(projectData.value?.tools.planning.enabled && hasFeature(me.value,'pmo.evm') ? [{key:'finance-tab-evm',label:t('nav.projectEvm'),to:`/projects/${props.projectId}/evm`,active:route.path.includes('/evm')}] : [])])
const sublevel = computed(() => props.level !== 'sections')
const governance = computed(() => props.level === 'governance')
</script>

<template>
  <SharedRouteTabs
    :items="governance ? governanceItems : props.level === 'planning' ? planningItems : props.level === 'finance' ? financeItems : sectionItems"
    :variant="sublevel ? 'pill' : 'underline'"
    :divider="false"
    :ariaLabel="t(sublevel ? 'projects.workspace.subtabsLabel' : 'projects.workspace.tabsLabel')"
    :data-testid="governance ? 'project-governance-tabs' : props.level === 'planning' ? 'project-planning-tabs' : 'project-workspace-tabs'"
  />
</template>
