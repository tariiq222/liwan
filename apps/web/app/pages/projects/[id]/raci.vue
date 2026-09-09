<script setup lang="ts">
import { inject } from 'vue'
import { governanceMatrixFilters } from '@/components/project/governance/state'
import { useGovernanceTaskPage, useProjectRaci, useProjectStakeholders, useCreateProjectRaci, useUpdateProjectRaci, useDeleteProjectRaci } from '@/composables/useProjectGovernance'
import type { ProjectRaci, ProjectRaciRole } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectWorkspaceTabs from '@/components/project/workspace/ProjectWorkspaceTabs.vue'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const id = computed(() => Number(route.params.id)); const viewport = computed(() => governanceMatrixFilters(route.query))
const { data: project } = useProject(computed(() => Number.isInteger(id.value) && id.value > 0 ? id.value : null))
const viewQuery = computed(() => {
  const query: Record<string, string> = {}
  if (typeof route.query.returnTo === 'string') query.returnTo = route.query.returnTo
  if (typeof route.query.taskContext === 'string') query.taskContext = route.query.taskContext
  if (typeof route.query.projectListReturnTo === 'string') query.projectListReturnTo = route.query.projectListReturnTo
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
      v-if="!isProjectOverlay"
      :title="project?.name ?? t('projects.governance.raci.title')"
    />
    <ProjectWorkspaceTabs v-if="project && !isProjectOverlay" :project-id="project.id" :active="project.active" :can-manage="project.can_manage" />
    <nav class="nasq-view-switch" :aria-label="t('projects.governance.views')">
      <NuxtLink :to="{ path: `/projects/${id}/stakeholders`, query: viewQuery }">{{ t('projects.governance.viewList') }}</NuxtLink>
      <NuxtLink :to="{ path: `/projects/${id}/raci`, query: viewQuery }" aria-current="page">{{ t('projects.governance.viewMatrix') }}</NuxtLink>
    </nav>
    <section class="nasq-panel overflow-hidden" aria-labelledby="raci-legend-title">
      <div class="nasq-panel-header"><h2 id="raci-legend-title">{{ t('projects.refresh.workspace.raciLegendTitle') }}</h2></div>
      <div class="nasq-panel-body space-y-2">
        <p class="text-sm text-muted-foreground">{{ t('projects.refresh.workspace.raciLegendDescription') }}</p>
        <dl class="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt class="font-semibold">R — {{ t('projects.refresh.workspace.raciResponsible') }}</dt><dd class="text-muted-foreground">{{ t('projects.refresh.workspace.raciResponsibleHint') }}</dd></div>
        <div><dt class="font-semibold">A — {{ t('projects.refresh.workspace.raciAccountable') }}</dt><dd class="text-muted-foreground">{{ t('projects.refresh.workspace.raciAccountableHint') }}</dd></div>
        <div><dt class="font-semibold">C — {{ t('projects.refresh.workspace.raciConsulted') }}</dt><dd class="text-muted-foreground">{{ t('projects.refresh.workspace.raciConsultedHint') }}</dd></div>
        <div><dt class="font-semibold">I — {{ t('projects.refresh.workspace.raciInformed') }}</dt><dd class="text-muted-foreground">{{ t('projects.refresh.workspace.raciInformedHint') }}</dd></div>
        </dl>
      </div>
    </section>
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-2"><Label for="raci-task-search">{{ t('projects.governance.raci.task') }}</Label><Input id="raci-task-search" v-model="taskSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" /><label class="flex gap-2 text-sm"><input v-model="closed" type="checkbox" :disabled="!hydrated || pending" />{{ t('projects.governance.closedTasks') }}</label></div>
      <div class="space-y-2"><Label for="raci-stakeholder-search">{{ t('projects.governance.raci.stakeholder') }}</Label><Input id="raci-stakeholder-search" v-model="stakeholderSearch" :disabled="!hydrated || pending" :placeholder="t('app.search')" /></div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <section v-if="confirmRow" class="nasq-panel overflow-hidden" role="group" :aria-label="t('projects.governance.confirmDelete')">
      <div class="nasq-panel-header"><h2>{{ t('projects.governance.confirmDelete') }}</h2></div>
      <div class="nasq-panel-body space-y-3">
        <p>{{ confirmRow.task.name }} — {{ confirmRow.stakeholder.name }} ({{ confirmRow.role }})</p>
        <div class="flex flex-wrap gap-2"><Button variant="destructive" :disabled="!hydrated || pending" @click="deleteRow">{{ t('projects.governance.confirmDeleteAction') }}</Button><Button variant="outline" :disabled="!hydrated || pending" @click="confirmRow = null">{{ t('app.cancel') }}</Button></div>
      </div>
    </section>
    <SharedPageState :loading="tasks.isLoading.value || stakeholders.isLoading.value || rows.isLoading.value" :error="tasks.error.value || stakeholders.error.value || rows.error.value" :empty="false" @retry="() => { tasks.refetch(); stakeholders.refetch(); rows.refetch() }" />
    <section v-if="!tasks.isLoading.value && !stakeholders.isLoading.value && !rows.isLoading.value && !tasks.error.value && !stakeholders.error.value && !rows.error.value && (!visibleTasks.length || !visibleStakeholders.length)" class="nasq-panel overflow-hidden" data-testid="raci-empty">
      <div class="nasq-panel-header"><h2>{{ t('projects.refresh.workspace.raciEmptyTitle') }}</h2></div>
      <div class="nasq-panel-body space-y-3">
        <p v-if="!visibleTasks.length && !visibleStakeholders.length" class="text-sm text-muted-foreground">{{ t('projects.refresh.workspace.raciEmptyBoth') }}</p>
        <p v-else-if="!visibleTasks.length" class="text-sm text-muted-foreground">{{ t('projects.refresh.workspace.raciEmptyTasks') }}</p>
        <p v-else class="text-sm text-muted-foreground">{{ t('projects.refresh.workspace.raciEmptyStakeholders') }}</p>
        <div class="flex flex-wrap gap-2">
        <NuxtLink v-if="!visibleTasks.length" :to="{ path: `/projects/${id}`, query: { ...route.query, tab: 'tasks' } }"><Button variant="outline">{{ t('projects.refresh.workspace.raciOpenTasks') }}</Button></NuxtLink>
        <NuxtLink v-if="!visibleStakeholders.length && rows.data.value?.can_manage" :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo: route.fullPath } }"><Button variant="outline">{{ t('projects.refresh.workspace.raciAddStakeholder') }}</Button></NuxtLink>
        </div>
      </div>
    </section>
    <section v-if="visibleTasks.length && visibleStakeholders.length" class="nasq-panel max-w-full overflow-x-auto overscroll-x-contain">
      <table class="w-full min-w-max text-start text-sm"><caption class="p-3 text-start">{{ t('projects.governance.raci.matrixHelp') }}</caption><thead><tr class="border-b"><th scope="col" class="sticky start-0 z-10 min-w-48 bg-background p-3 text-start">{{ t('projects.governance.raci.task') }}</th><th v-for="item in visibleStakeholders" :key="item.id" scope="col" class="min-w-32 p-3 text-start"><NuxtLink class="underline" :to="{ path: `/projects/${id}/stakeholders/${item.id}`, query: { returnTo: route.fullPath } }">{{ item.name }}</NuxtLink></th></tr></thead>
        <tbody><tr v-for="task in visibleTasks" :key="task.id" class="border-b"><th scope="row" class="sticky start-0 z-10 bg-background p-3 text-start font-medium"><NuxtLink class="underline" :to="{ path: `/projects/${id}/tasks/${task.id}`, query: { returnTo: route.fullPath } }">{{ task.name }}</NuxtLink></th><td v-for="item in visibleStakeholders" :key="item.id" class="p-3">
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
