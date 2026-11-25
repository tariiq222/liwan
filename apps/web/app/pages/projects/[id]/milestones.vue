<script setup lang="ts">
import MilestoneTable from '@/components/pmo/projects/MilestoneTable.vue'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'
import { useMilestones } from '@/composables/useMilestones'
import { isMilestoneOverdue } from '@/components/pmo/projects/milestoneState'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { returnToQuery, safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
// The KPI tiles count the rows the table loads, so they read the same query and start with the table: the same key is
// shared, so no second request goes out and the two never disagree about a milestone.
const milestones = useMilestones(computed(() => project.value ? projectId.value : null))
const milestoneRows = computed(() => milestones.data.value ?? [])
const milestoneCounts = computed(() => ({
  open: milestoneRows.value.filter(milestone => !milestone.is_reached).length,
  completed: milestoneRows.value.filter(milestone => milestone.is_reached).length,
  overdue: milestoneRows.value.filter(isMilestoneOverdue).length,
}))
// The shared strip draws the same three counts; no tile filters this list, so none is a link.
const tiles = computed<KpiTile[]>(() => [
  { id: 'open', label: t('projects.milestones.kpi.open'), value: milestoneCounts.value.open, icon: 'i-lucide-flag', tone: 'neutral' },
  { id: 'completed', label: t('projects.milestones.kpi.completed'), value: milestoneCounts.value.completed, icon: 'i-lucide-circle-check', tone: 'success' },
  { id: 'overdue', label: t('projects.milestones.kpi.overdue'), value: milestoneCounts.value.overdue, icon: 'i-lucide-circle-alert', tone: milestoneCounts.value.overdue > 0 ? 'danger' : 'neutral' },
])
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications']))
const canCreate = computed(() => project.value?.can_manage === true && project.value.active)
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/milestones/, '')
  return rest === '' || rest === '/new'
})

const createTo = computed(() => ({ path: `/projects/${projectId.value}/milestones/new`, query: returnToQuery(route.fullPath) }))
</script>

<template>
  <template v-if="isListRoute">
    <SharedPageContainer v-if="notFound || error">
      <ProjectNotFoundState v-if="notFound" embedded :back-to="projectReturnTo" />
      <SharedPageState v-else :error="error" @retry="refetch" />
    </SharedPageContainer>
    <!-- The frame is this page's h1: hide-header draws no heading, the create button stays in the header row. -->
    <SharedListPage
      v-else
      hide-header
      :title="t('projects.tabs.milestones')"
      :create-to="canCreate ? createTo : undefined"
      :create-label="t('projects.milestones.new')"
      create-test-id="project-header-create"
    >
      <template #kpis>
        <SharedKpiStrip v-if="!milestones.isError.value" :tiles="tiles" :loading="milestones.isPending.value" :label="t('projects.milestones.kpi.label')" data-testid="milestone-kpi-strip" />
      </template>
      <MilestoneTable v-if="project" :project-id="project.id" :can-manage="project.can_manage && project.active" />
      <SharedLoadingSkeleton v-else-if="isLoading || !hydrated" />
    </SharedListPage>
  </template>
  <NuxtPage />
</template>
