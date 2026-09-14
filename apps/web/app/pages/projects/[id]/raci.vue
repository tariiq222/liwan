<script setup lang="ts">
import { inject } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { settleServerQueries } from '@/lib/vueQuerySsr'
import { governanceMatrixFilters } from '@/composables/projectGovernanceKeys'
import { RACI_ROLE_TONE } from '@/components/project/governance/state'
import { STATUS_COLOR } from '@/utils/statusTone'
import { useGovernanceTaskPage, useProjectRaci, useProjectStakeholders, useCreateProjectRaci, useUpdateProjectRaci, useDeleteProjectRaci } from '@/composables/useProjectGovernance'
import type { ProjectRaci, ProjectRaciRole } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
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
function roleColor(taskId: number, stakeholderId: number) {
  const role = assignment(taskId, stakeholderId)?.role
  return role ? STATUS_COLOR[RACI_ROLE_TONE[role]] : undefined
}
function nextTasks() { taskPage.value++ }
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
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader
      v-if="!isProjectOverlay"
      :title="t('projects.governance.raci.title')"
    />
    <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated || pending" @clear="clearFilters">
      <template #search>
        <div class="grid min-w-0 gap-3 sm:grid-cols-2">
          <UFormField :label="t('projects.governance.raci.task')">
            <UInput v-model="taskSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" class="w-full" />
          </UFormField>
          <UFormField :label="t('projects.governance.raci.stakeholder')">
            <UInput v-model="stakeholderSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #view>
        <UTabs
          data-testid="raci-closed-scope"
          :model-value="closed ? 'closed' : 'open'"
          :items="[{ label: t('projects.governance.openTasks'), value: 'open', disabled: !hydrated || pending }, { label: t('projects.governance.closedTasks'), value: 'closed', disabled: !hydrated || pending }]"
          size="sm"
          @update:model-value="closed = $event === 'closed'"
        />
      </template>
      <template #active>
        <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
          <SharedFilterChip v-if="taskSearch.trim()" :label="`${t('projects.governance.raci.task')}: ${taskSearch}`" :disabled="pending" @remove="taskSearch = ''" />
          <SharedFilterChip v-if="stakeholderSearch.trim()" :label="`${t('projects.governance.raci.stakeholder')}: ${stakeholderSearch}`" :disabled="pending" @remove="stakeholderSearch = ''" />
        </div>
      </template>
    </FilterBar>
    <section class="rounded-lg ring ring-default bg-default overflow-hidden" aria-labelledby="raci-legend-title">
      <div class="border-b border-default px-5 py-4"><h2 id="raci-legend-title" class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.raciLegendTitle') }}</h2></div>
      <div class="p-5 space-y-2">
        <p class="text-sm text-muted">{{ t('projects.refresh.workspace.raciLegendDescription') }}</p>
        <dl class="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt class="font-semibold">R — {{ t('projects.refresh.workspace.raciResponsible') }}</dt><dd class="text-muted">{{ t('projects.refresh.workspace.raciResponsibleHint') }}</dd></div>
        <div><dt class="font-semibold">A — {{ t('projects.refresh.workspace.raciAccountable') }}</dt><dd class="text-muted">{{ t('projects.refresh.workspace.raciAccountableHint') }}</dd></div>
        <div><dt class="font-semibold">C — {{ t('projects.refresh.workspace.raciConsulted') }}</dt><dd class="text-muted">{{ t('projects.refresh.workspace.raciConsultedHint') }}</dd></div>
        <div><dt class="font-semibold">I — {{ t('projects.refresh.workspace.raciInformed') }}</dt><dd class="text-muted">{{ t('projects.refresh.workspace.raciInformedHint') }}</dd></div>
        </dl>
      </div>
    </section>
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
    <SharedPageState :loading="tasks.isLoading.value || stakeholders.isLoading.value || rows.isLoading.value" :error="tasks.error.value || stakeholders.error.value || rows.error.value" :empty="false" @retry="() => { tasks.refetch(); stakeholders.refetch(); rows.refetch() }" />
    <section v-if="!tasks.isLoading.value && !stakeholders.isLoading.value && !rows.isLoading.value && !tasks.error.value && !stakeholders.error.value && !rows.error.value && (!visibleTasks.length || !visibleStakeholders.length)" class="rounded-lg ring ring-default bg-default overflow-hidden" data-testid="raci-empty">
      <div class="border-b border-default px-5 py-4"><h2 class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.raciEmptyTitle') }}</h2></div>
      <div class="p-5 space-y-3">
        <p v-if="!visibleTasks.length && !visibleStakeholders.length" class="text-sm text-muted">{{ t('projects.refresh.workspace.raciEmptyBoth') }}</p>
        <p v-else-if="!visibleTasks.length" class="text-sm text-muted">{{ t('projects.refresh.workspace.raciEmptyTasks') }}</p>
        <p v-else class="text-sm text-muted">{{ t('projects.refresh.workspace.raciEmptyStakeholders') }}</p>
        <div class="flex flex-wrap gap-2">
        <UButton v-if="!visibleTasks.length" color="neutral" variant="outline" :to="{ path: `/projects/${id}`, query: { ...route.query, tab: 'tasks' } }">{{ t('projects.refresh.workspace.raciOpenTasks') }}</UButton>
        <UButton v-if="!visibleStakeholders.length && rows.data.value?.can_manage" color="neutral" variant="outline" icon="i-lucide-plus" :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo: route.fullPath } }">{{ t('projects.refresh.workspace.raciAddStakeholder') }}</UButton>
        </div>
      </div>
    </section>
    <section v-if="visibleTasks.length && visibleStakeholders.length" class="rounded-lg ring ring-default bg-default max-w-full overflow-x-auto overscroll-x-contain">
      <table class="w-full min-w-max text-start text-sm"><caption class="p-3 text-start">{{ t('projects.governance.raci.matrixHelp') }}</caption><thead><tr class="border-b"><th scope="col" class="sticky start-0 z-10 h-auto w-28 min-w-28 max-w-28 bg-default p-3 text-start">{{ t('app.recordNumber') }}</th><th scope="col" class="sticky start-28 z-10 min-w-48 bg-default p-3 text-start">{{ t('projects.governance.raci.task') }}</th><th v-for="item in visibleStakeholders" :key="item.id" scope="col" class="min-w-32 p-3 text-start"><NuxtLink class="underline" :to="{ path: `/projects/${id}/stakeholders/${item.id}`, query: { returnTo: route.fullPath } }">{{ item.name }}</NuxtLink></th></tr></thead>
        <tbody><tr v-for="task in visibleTasks" :key="task.id" class="border-b"><td class="sticky start-0 z-10 h-auto w-28 min-w-28 max-w-28 bg-default p-3"><RecordNumber :value="task.id" /></td><th scope="row" class="sticky start-28 z-10 bg-default p-3 text-start font-medium"><NuxtLink class="underline" :to="{ path: `/projects/${id}/tasks/${task.id}` }">{{ task.name }}</NuxtLink></th><td v-for="item in visibleStakeholders" :key="item.id" class="p-3">
          <USelect v-if="rows.data.value?.can_manage" :model-value="assignment(task.id, item.id)?.role ?? 'none'" :items="[{ value: 'none', label: '—' }, ...['R', 'A', 'C', 'I'].map(role => ({ value: role, label: role }))]" :aria-label="`${task.name} — ${item.name} — ${t('projects.governance.raci.role')}`" class="min-w-24" :color="roleColor(task.id, item.id)" :disabled="!hydrated || pending || loading || !!confirmRow" @update:model-value="changeRole(task.id, item.id, $event)" /><UBadge v-else variant="subtle" :color="roleColor(task.id, item.id)">{{ assignment(task.id, item.id)?.role ?? '—' }}</UBadge>
        </td></tr></tbody>
      </table>
      <p class="p-3 text-sm text-muted">{{ t('projects.governance.raci.legend') }}</p>
    </section>
    <div class="grid gap-3 sm:grid-cols-2">
      <nav class="flex items-center gap-2" :aria-label="t('projects.governance.raci.task')"><UButton color="neutral" variant="ghost" :disabled="!hydrated || loading || pending || !taskPage" :label="t('projects.governance.previous')" @click="taskPage--" /><span>{{ t('projects.governance.total', { total: tasks.data.value?.total ?? 0 }) }}</span><UButton color="neutral" variant="ghost" :disabled="!hydrated || loading || pending || (taskPage + 1) * 50 >= (tasks.data.value?.total ?? 0)" :label="t('projects.governance.next')" @click="nextTasks" /></nav>
      <nav class="flex items-center gap-2" :aria-label="t('projects.governance.raci.stakeholder')"><UButton color="neutral" variant="ghost" :disabled="!hydrated || loading || pending || !stakeholderPage" :label="t('projects.governance.previous')" @click="stakeholderPage--" /><span>{{ t('projects.governance.total', { total: stakeholders.data.value?.total ?? 0 }) }}</span><UButton color="neutral" variant="ghost" :disabled="!hydrated || loading || pending || (stakeholderPage + 1) * 10 >= (stakeholders.data.value?.total ?? 0)" :label="t('projects.governance.next')" @click="stakeholderPage++" /></nav>
    </div>
  </SharedPageContainer>
</template>
