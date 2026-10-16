<script setup lang="ts">
import RaciMatrix from '@/components/pmo/projects/governance/RaciMatrix.vue'
import { useQueryClient } from '@tanstack/vue-query'
import { settleServerQueries } from '@/lib/vueQuerySsr'
import { governanceMatrixFilters } from '@/composables/projectGovernanceKeys'
import { useGovernanceTaskPage, useProjectRaci, useProjectStakeholders, useCreateProjectRaci, useUpdateProjectRaci, useDeleteProjectRaci } from '@/composables/useProjectGovernance'
import type { ProjectRaci, ProjectRaciRole } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import FilterBar from '@nasq/ui/app/components/shared/data/FilterBar.vue'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.id)); const viewport = computed(() => governanceMatrixFilters(route.query))
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
const settled = computed(() => !tasks.isLoading.value && !stakeholders.isLoading.value && !rows.isLoading.value && !tasks.error.value && !stakeholders.error.value && !rows.error.value)
</script>
<template>
  <SharedListPage hide-header :title="t('projects.governance.raci.title')">
    <template #filters>
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated || pending" @clear="clearFilters">
        <template #search>
          <div class="grid min-w-0 gap-3 sm:grid-cols-2">
            <UFormField :label="t('projects.governance.raci.task')"><UInput v-model="taskSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" class="w-full" /></UFormField>
            <UFormField :label="t('projects.governance.raci.stakeholder')"><UInput v-model="stakeholderSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" class="w-full" /></UFormField>
          </div>
        </template>
        <template #view>
          <UTabs data-testid="raci-closed-scope" :model-value="closed ? 'closed' : 'open'" :items="[{ label: t('projects.governance.openTasks'), value: 'open', disabled: !hydrated || pending }, { label: t('projects.governance.closedTasks'), value: 'closed', disabled: !hydrated || pending }]" size="sm" @update:model-value="closed = $event === 'closed'" />
        </template>
        <template #active>
          <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip v-if="taskSearch.trim()" :label="`${t('projects.governance.raci.task')}: ${taskSearch}`" :disabled="pending" @remove="taskSearch = ''" />
            <SharedFilterChip v-if="stakeholderSearch.trim()" :label="`${t('projects.governance.raci.stakeholder')}: ${stakeholderSearch}`" :disabled="pending" @remove="stakeholderSearch = ''" />
          </div>
        </template>
      </FilterBar>
    </template>

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

    <SharedPageState v-if="!settled" :loading="tasks.isLoading.value || stakeholders.isLoading.value || rows.isLoading.value" :error="tasks.error.value || stakeholders.error.value || rows.error.value" :empty="false" @retry="() => { tasks.refetch(); stakeholders.refetch(); rows.refetch() }" />
    <SharedEmptyState
      v-else-if="!visibleTasks.length || !visibleStakeholders.length"
      data-testid="raci-empty"
      :title="t('projects.refresh.workspace.raciEmptyTitle')"
      :description="t(!visibleTasks.length && !visibleStakeholders.length ? 'projects.refresh.workspace.raciEmptyBoth' : !visibleTasks.length ? 'projects.refresh.workspace.raciEmptyTasks' : 'projects.refresh.workspace.raciEmptyStakeholders')"
    >
      <template #action>
        <UButton v-if="!visibleTasks.length" color="neutral" variant="outline" :to="{ path: `/projects/${id}`, query: { ...route.query, tab: 'tasks' } }">{{ t('projects.refresh.workspace.raciOpenTasks') }}</UButton>
        <UButton v-if="!visibleStakeholders.length && rows.data.value?.can_manage" color="neutral" variant="outline" icon="i-lucide-plus" :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo: route.fullPath } }">{{ t('projects.refresh.workspace.raciAddStakeholder') }}</UButton>
      </template>
    </SharedEmptyState>
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

    <div class="grid gap-3 sm:grid-cols-2">
      <div role="group" :aria-label="t('projects.governance.raci.task')"><SharedPagination :page="taskPageNumber" :pages="taskPages" :disabled="loading || pending" @update:page="taskPage = $event - 1" /></div>
      <div role="group" :aria-label="t('projects.governance.raci.stakeholder')"><SharedPagination :page="stakeholderPageNumber" :pages="stakeholderPages" :disabled="loading || pending" @update:page="stakeholderPage = $event - 1" /></div>
    </div>
    <SharedRecordSection panel :title="t('projects.refresh.workspace.raciLegendTitle')" :description="t('projects.refresh.workspace.raciLegendDescription')">
      <dl class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div class="flex items-start gap-2">
          <span class="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-semibold text-highlighted ring ring-default">R</span>
          <div class="min-w-0"><dt class="text-sm font-medium text-highlighted">{{ t('projects.refresh.workspace.raciResponsible') }}</dt><dd class="text-xs text-muted">{{ t('projects.refresh.workspace.raciResponsibleHint') }}</dd></div>
        </div>
        <div class="flex items-start gap-2">
          <span class="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-semibold text-highlighted ring ring-default">A</span>
          <div class="min-w-0"><dt class="text-sm font-medium text-highlighted">{{ t('projects.refresh.workspace.raciAccountable') }}</dt><dd class="text-xs text-muted">{{ t('projects.refresh.workspace.raciAccountableHint') }}</dd></div>
        </div>
        <div class="flex items-start gap-2">
          <span class="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-semibold text-highlighted ring ring-default">C</span>
          <div class="min-w-0"><dt class="text-sm font-medium text-highlighted">{{ t('projects.refresh.workspace.raciConsulted') }}</dt><dd class="text-xs text-muted">{{ t('projects.refresh.workspace.raciConsultedHint') }}</dd></div>
        </div>
        <div class="flex items-start gap-2">
          <span class="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-semibold text-highlighted ring ring-default">I</span>
          <div class="min-w-0"><dt class="text-sm font-medium text-highlighted">{{ t('projects.refresh.workspace.raciInformed') }}</dt><dd class="text-xs text-muted">{{ t('projects.refresh.workspace.raciInformedHint') }}</dd></div>
        </div>
      </dl>
    </SharedRecordSection>
  </SharedListPage>
</template>
