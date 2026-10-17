<script setup lang="ts">
import RaciMatrix from '@/components/pmo/projects/governance/RaciMatrix.vue'
import { useQueryClient } from '@tanstack/vue-query'
import { settleServerQueries } from '@/lib/vueQuerySsr'
import { governanceMatrixFilters } from '@/composables/projectGovernanceKeys'
import { useGovernanceTaskPage, useProjectRaci, useProjectStakeholders, useCreateProjectRaci, useUpdateProjectRaci, useDeleteProjectRaci } from '@/composables/useProjectGovernance'
import type { ProjectRaci, ProjectRaciRole } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { RACI_ROLE_TONE } from '@/components/pmo/projects/governance/state'
import { projectSectionLocation } from '@/utils/projectWorkspaceMemory'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.id)); const viewport = computed(() => governanceMatrixFilters(route.query))
const tasksTo = computed(() => projectSectionLocation(`/projects/${id.value}/tasks`, route.path, route.query))
function replaceFilter(key: string, value: string | undefined, pageKey: string) { router.replace({ query: { ...route.query, [key]: value, [pageKey]: undefined } }) }
const taskSearch = computed({ get: () => viewport.value.taskQ, set: value => replaceFilter('task_q', value || undefined, 'task_page') })
const stakeholderSearch = computed({ get: () => viewport.value.stakeholderQ, set: value => replaceFilter('stakeholder_q', value || undefined, 'stakeholder_page') })
const closed = computed({ get: () => viewport.value.closed, set: value => replaceFilter('closed', value ? '1' : undefined, 'task_page') })
const taskPage = computed({ get: () => viewport.value.taskPage, set: value => { router.push({ query: { ...route.query, task_page: String(Math.max(0, value)) } }) } })
const stakeholderPage = computed({ get: () => viewport.value.stakeholderPage, set: value => { router.push({ query: { ...route.query, stakeholder_page: String(Math.max(0, value)) } }) } })
const tasks = useGovernanceTaskPage(id, computed(() => ({ q: taskSearch.value, closed: closed.value, offset: taskPage.value * 50 })))
const stakeholders = useProjectStakeholders(id, computed(() => ({ q: stakeholderSearch.value || undefined, limit: 10, offset: stakeholderPage.value * 10 })))
const visibleTasks = computed(() => tasks.data.value?.items ?? [])
const visibleStakeholders = computed(() => stakeholders.data.value?.items ?? [])
// The assignment query key depends on both lists. Resolve the active SSR
// requests before creating its observer so hydration uses the same key.
const queryClient = useQueryClient()
if (import.meta.server) await settleServerQueries(queryClient)
const rows = useProjectRaci(id, computed(() => ({ task_ids: visibleTasks.value.map(task => task.id).join(','), stakeholder_ids: visibleStakeholders.value.map(item => item.id).join(',') })))
const create = useCreateProjectRaci(); const update = useUpdateProjectRaci(); const remove = useDeleteProjectRaci()
const pending = computed(() => create.isPending.value || update.isPending.value || remove.isPending.value)
const loading = computed(() => tasks.isFetching.value || stakeholders.isFetching.value || rows.isFetching.value)
const activeFilterCount = computed(() => Number(Boolean(taskSearch.value.trim())) + Number(Boolean(stakeholderSearch.value.trim())))
const error = ref<string | null>(null); const confirmRow = ref<ProjectRaci | null>(null)
const assignments = computed(() => new Map(rows.data.value?.items.map(row => [`${row.task.id}:${row.stakeholder.id}`, row])))
function assignment(taskId: number, stakeholderId: number) { return assignments.value.get(`${taskId}:${stakeholderId}`) }
function clearFilters() {
  router.replace({ query: { ...route.query, task_q: undefined, stakeholder_q: undefined, task_page: undefined, stakeholder_page: undefined } })
}
async function changeRole(taskId: number, stakeholderId: number, value: string) {
  if (pending.value || loading.value || confirmRow.value) return
  const row = assignment(taskId, stakeholderId)
  const role = value === 'none' ? null : value as ProjectRaciRole
  error.value = null
  if (!role) { if (row) confirmRow.value = row; return }
  try {
    if (row) await update.mutateAsync({ projectId: id.value, id: row.id, body: { role } })
    else await create.mutateAsync({ projectId: id.value, body: { task_id: taskId, stakeholder_id: stakeholderId, role } })
  } catch (cause) { error.value = cause instanceof ApiError ? cause.message : t('errors.generic') }
}
async function deleteRow() {
  if (!confirmRow.value) return
  error.value = null
  try { await remove.mutateAsync({ projectId: id.value, id: confirmRow.value.id }); confirmRow.value = null }
  catch (cause) { error.value = cause instanceof ApiError ? cause.message : t('errors.generic') }
}
const TASK_PAGE = 50
const STAKEHOLDER_PAGE = 10
const taskPageNumber = computed(() => taskPage.value + 1)
const taskPages = computed(() => Math.max(1, taskPageNumber.value, Math.ceil((tasks.data.value?.total ?? 0) / TASK_PAGE)))
const stakeholderPageNumber = computed(() => stakeholderPage.value + 1)
const stakeholderPages = computed(() => Math.max(1, stakeholderPageNumber.value, Math.ceil((stakeholders.data.value?.total ?? 0) / STAKEHOLDER_PAGE)))
const scopeItems = computed(() => [
  { value: 'open', label: t('projects.governance.openTasks') },
  { value: 'closed', label: t('projects.governance.closedTasks') },
])
// The same four roles as the matrix chips, in the order of the acronym.
const legend = computed(() => [
  { role: 'R' as const, name: t('projects.refresh.workspace.raciResponsible'), hint: t('projects.refresh.workspace.raciResponsibleHint') },
  { role: 'A' as const, name: t('projects.refresh.workspace.raciAccountable'), hint: t('projects.refresh.workspace.raciAccountableHint') },
  { role: 'C' as const, name: t('projects.refresh.workspace.raciConsulted'), hint: t('projects.refresh.workspace.raciConsultedHint') },
  { role: 'I' as const, name: t('projects.refresh.workspace.raciInformed'), hint: t('projects.refresh.workspace.raciInformedHint') },
])
const noMatrix = computed(() => !visibleTasks.value.length || !visibleStakeholders.value.length)
const settled = computed(() => !tasks.isLoading.value && !stakeholders.isLoading.value && !rows.isLoading.value && !tasks.error.value && !stakeholders.error.value && !rows.error.value)
</script>
<template>
  <SharedListPage hide-header :title="t('projects.governance.raci.title')">
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <!-- role="group" keeps the confirmation addressable by its question while the matrix stays locked. -->
    <SharedInlineConfirm
      v-if="confirmRow"
      role="group"
      :aria-label="t('projects.governance.confirmDelete')"
      data-testid="raci-delete-confirm"
      :title="t('projects.governance.confirmDelete')"
      :description="`${confirmRow.task.name} — ${confirmRow.stakeholder.name} (${confirmRow.role})`"
      :confirm-label="t('projects.governance.confirmDeleteAction')"
      :pending="pending"
      @cancel="confirmRow = null"
      @confirm="deleteRow"
    />

    <SharedListCard>
      <template #filters>
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated || pending" @clear="clearFilters">
          <template #search>
            <UInput v-model="taskSearch" icon="i-lucide-search" :disabled="!hydrated || pending" :aria-label="t('projects.governance.raci.searchTasks')" :placeholder="t('projects.governance.raci.searchTasks')" class="w-full min-w-52">
              <template v-if="taskSearch" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('projects.filters.clearSearch')" class="-me-1" :disabled="pending" @click="taskSearch = ''" />
              </template>
            </UInput>
          </template>
          <template #default>
            <UInput v-model="stakeholderSearch" icon="i-lucide-users" :disabled="!hydrated || pending" :aria-label="t('projects.governance.raci.searchStakeholders')" :placeholder="t('projects.governance.raci.searchStakeholders')" class="w-full md:w-64">
              <template v-if="stakeholderSearch" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('projects.filters.clearSearch')" class="-me-1" :disabled="pending" @click="stakeholderSearch = ''" />
              </template>
            </UInput>
          </template>
          <template #view>
            <SharedSegmentedControl data-testid="raci-closed-scope" :label="t('projects.governance.raci.task')" :items="scopeItems" :model-value="closed ? 'closed' : 'open'" :disabled="!hydrated || pending" @update:model-value="closed = $event === 'closed'" />
          </template>
        </FilterBar>
      </template>
      <SharedPageState v-if="!settled" :loading="tasks.isLoading.value || stakeholders.isLoading.value || rows.isLoading.value" :error="tasks.error.value || stakeholders.error.value || rows.error.value" :empty="false" @retry="() => { tasks.refetch(); stakeholders.refetch(); rows.refetch() }" />
      <div v-else-if="noMatrix" class="p-(--webvue-card-pad)">
        <SharedEmptyState
          data-testid="raci-empty"
          :title="t('projects.refresh.workspace.raciEmptyTitle')"
          :description="t(!visibleTasks.length && !visibleStakeholders.length ? 'projects.refresh.workspace.raciEmptyBoth' : !visibleTasks.length ? 'projects.refresh.workspace.raciEmptyTasks' : 'projects.refresh.workspace.raciEmptyStakeholders')"
        >
          <template #action>
            <UButton v-if="!visibleTasks.length" color="neutral" variant="outline" :to="tasksTo">{{ t('projects.refresh.workspace.raciOpenTasks') }}</UButton>
            <UButton v-if="!visibleStakeholders.length && rows.data.value?.can_manage" color="neutral" variant="outline" icon="i-lucide-plus" :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo: route.fullPath } }">{{ t('projects.refresh.workspace.raciAddStakeholder') }}</UButton>
          </template>
        </SharedEmptyState>
      </div>
      <RaciMatrix
        v-else
        :project-id="id"
        :tasks="visibleTasks"
        :stakeholders="visibleStakeholders"
        :assignments="assignments"
        :can-manage="rows.data.value?.can_manage === true"
        :locked="pending || loading || !!confirmRow"
        :return-to="route.fullPath"
        @change="changeRole"
      />
      <template v-if="taskPages > 1 || stakeholderPages > 1" #footer>
        <div class="grid w-full gap-(--webvue-gap-card) sm:grid-cols-2">
          <div role="group" :aria-label="t('projects.governance.raci.task')"><SharedPagination :page="taskPageNumber" :pages="taskPages" :disabled="loading || pending" @update:page="taskPage = $event - 1" /></div>
          <div role="group" :aria-label="t('projects.governance.raci.stakeholder')"><SharedPagination :page="stakeholderPageNumber" :pages="stakeholderPages" :disabled="loading || pending" @update:page="stakeholderPage = $event - 1" /></div>
        </div>
      </template>
    </SharedListCard>

    <SharedRecordSection variant="tinted" :title="t('projects.refresh.workspace.raciLegendTitle')" :description="t('projects.refresh.workspace.raciLegendDescription')">
      <dl class="grid grid-cols-2 gap-(--webvue-gap-card) lg:grid-cols-4">
        <div v-for="item in legend" :key="item.role" class="flex items-start gap-2">
          <SharedStatusBadge class="min-w-8 shrink-0 justify-center" :tone="RACI_ROLE_TONE[item.role]" :label="item.role" />
          <div class="min-w-0"><dt class="text-sm font-medium text-highlighted">{{ item.name }}</dt><dd class="text-xs text-muted">{{ item.hint }}</dd></div>
        </div>
      </dl>
    </SharedRecordSection>
  </SharedListPage>
</template>
