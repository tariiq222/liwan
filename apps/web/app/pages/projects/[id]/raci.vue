<script setup lang="ts">
import { governanceMatrixFilters } from '@/components/project/governance/state'
import { useGovernanceTaskPage, useProjectRaci, useProjectStakeholders, useCreateProjectRaci, useUpdateProjectRaci, useDeleteProjectRaci } from '@/composables/useProjectGovernance'
import type { ProjectRaci, ProjectRaciRole } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.id)); const viewport = computed(() => governanceMatrixFilters(route.query))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${id.value}`, ['/projects']))
const viewQuery = computed(() => {
  const query: Record<string, string> = {}
  if (typeof route.query.returnTo === 'string') query.returnTo = route.query.returnTo
  if (typeof route.query.taskContext === 'string') query.taskContext = route.query.taskContext
  return query
})
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
const rows = useProjectRaci(id, computed(() => ({ task_ids: visibleTasks.value.map(task => task.id).join(','), stakeholder_ids: visibleStakeholders.value.map(item => item.id).join(',') })))
const create = useCreateProjectRaci(); const update = useUpdateProjectRaci(); const remove = useDeleteProjectRaci()
const pending = computed(() => create.isPending.value || update.isPending.value || remove.isPending.value)
const loading = computed(() => tasks.isFetching.value || stakeholders.isFetching.value || rows.isFetching.value)
const error = ref<string | null>(null); const confirmRow = ref<ProjectRaci | null>(null)
const assignments = computed(() => new Map(rows.data.value?.items.map(row => [`${row.task.id}:${row.stakeholder.id}`, row])))
function assignment(taskId: number, stakeholderId: number) { return assignments.value.get(`${taskId}:${stakeholderId}`) }
function nextTasks() { taskPage.value++ }
async function changeRole(taskId: number, stakeholderId: number, event: Event) {
  const select = event.target as HTMLSelectElement
  const row = assignment(taskId, stakeholderId); const role = select.value as ProjectRaciRole
  select.value = row?.role ?? '' // keep the authoritative value until the mutation/refetch completes
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
      :title="t('projects.governance.raci.title')"
      :description="t('projects.governance.raci.description')"
      :back-to="returnTo"
      :back-label="t('projects.backToProject')"
    />
    <nav class="nasq-view-switch" :aria-label="t('projects.governance.views')">
      <NuxtLink :to="{ path: `/projects/${id}/stakeholders`, query: viewQuery }">{{ t('projects.governance.viewList') }}</NuxtLink>
      <NuxtLink :to="{ path: `/projects/${id}/raci`, query: viewQuery }" aria-current="page">{{ t('projects.governance.viewMatrix') }}</NuxtLink>
    </nav>
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-2"><Label for="raci-task-search">{{ t('projects.governance.raci.task') }}</Label><Input id="raci-task-search" v-model="taskSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" /><label class="flex gap-2 text-sm"><input v-model="closed" type="checkbox" :disabled="!hydrated || pending" />{{ t('projects.governance.closedTasks') }}</label></div>
      <div class="space-y-2"><Label for="raci-stakeholder-search">{{ t('projects.governance.raci.stakeholder') }}</Label><Input id="raci-stakeholder-search" v-model="stakeholderSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" /></div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <section v-if="confirmRow" class="nasq-panel nasq-panel-body space-y-3" role="group" :aria-label="t('projects.governance.confirmDelete')">
      <p>{{ t('projects.governance.confirmDelete') }} {{ confirmRow.task.name }} — {{ confirmRow.stakeholder.name }} ({{ confirmRow.role }})</p>
      <div class="flex gap-2"><Button variant="destructive" :disabled="!hydrated || pending" @click="deleteRow">{{ t('projects.governance.confirmDeleteAction') }}</Button><Button variant="outline" :disabled="!hydrated || pending" @click="confirmRow = null">{{ t('app.cancel') }}</Button></div>
    </section>
    <SharedPageState :loading="tasks.isLoading.value || stakeholders.isLoading.value || rows.isLoading.value" :error="tasks.error.value || stakeholders.error.value || rows.error.value" :empty="!loading && (!visibleTasks.length || !visibleStakeholders.length)" @retry="() => { tasks.refetch(); stakeholders.refetch(); rows.refetch() }" />
    <section v-if="visibleTasks.length && visibleStakeholders.length" class="nasq-panel overflow-x-auto">
      <table class="w-full text-start text-sm"><caption class="p-3 text-start">{{ t('projects.governance.raci.matrixHelp') }}</caption><thead><tr class="border-b"><th scope="col" class="min-w-48 p-3 text-start">{{ t('projects.governance.raci.task') }}</th><th v-for="item in visibleStakeholders" :key="item.id" scope="col" class="min-w-32 p-3 text-start"><NuxtLink class="underline" :to="{ path: `/projects/${id}/stakeholders/${item.id}`, query: { returnTo: route.fullPath } }">{{ item.name }}</NuxtLink></th></tr></thead>
        <tbody><tr v-for="task in visibleTasks" :key="task.id" class="border-b"><th scope="row" class="p-3 text-start font-medium"><NuxtLink class="underline" :to="{ path: `/projects/${id}/tasks/${task.id}`, query: { returnTo: route.fullPath } }">{{ task.name }}</NuxtLink></th><td v-for="item in visibleStakeholders" :key="item.id" class="p-3">
          <select v-if="rows.data.value?.can_manage" :value="assignment(task.id, item.id)?.role ?? ''" :aria-label="`${task.name} — ${item.name} — ${t('projects.governance.raci.role')}`" class="border-input h-[40px] min-w-24 rounded-lg border bg-transparent px-3 text-sm shadow-none outline-none focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50" :disabled="!hydrated || pending || loading || !!confirmRow" @change="changeRole(task.id, item.id, $event)"><option value="">—</option><option v-for="role in ['R', 'A', 'C', 'I']" :key="role" :value="role">{{ role }}</option></select><span v-else>{{ assignment(task.id, item.id)?.role ?? '—' }}</span>
        </td></tr></tbody>
      </table>
      <p class="p-3 text-sm text-muted-foreground">{{ t('projects.governance.raci.legend') }}</p>
    </section>
    <div class="grid gap-3 sm:grid-cols-2">
      <nav class="flex items-center gap-2" :aria-label="t('projects.governance.raci.task')"><Button variant="outline" :disabled="!hydrated || loading || pending || !taskPage" @click="taskPage--">{{ t('projects.governance.previous') }}</Button><span>{{ t('projects.governance.total', { total: tasks.data.value?.total ?? 0 }) }}</span><Button variant="outline" :disabled="!hydrated || loading || pending || (taskPage + 1) * 50 >= (tasks.data.value?.total ?? 0)" @click="nextTasks">{{ t('projects.governance.next') }}</Button></nav>
      <nav class="flex items-center gap-2" :aria-label="t('projects.governance.raci.stakeholder')"><Button variant="outline" :disabled="!hydrated || loading || pending || !stakeholderPage" @click="stakeholderPage--">{{ t('projects.governance.previous') }}</Button><span>{{ t('projects.governance.total', { total: stakeholders.data.value?.total ?? 0 }) }}</span><Button variant="outline" :disabled="!hydrated || loading || pending || (stakeholderPage + 1) * 10 >= (stakeholders.data.value?.total ?? 0)" @click="stakeholderPage++">{{ t('projects.governance.next') }}</Button></nav>
    </div>
  </SharedPageContainer>
</template>
