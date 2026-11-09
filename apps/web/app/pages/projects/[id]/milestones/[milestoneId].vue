<script setup lang="ts">
import type { MilestonePatch } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useMilestones, useUpdateMilestone, useDeleteMilestone } from '@/composables/useMilestones'
import { milestoneBadge } from '@/components/pmo/projects/milestoneState'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { parsePositiveId } from '@/utils/routeParams'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { statusPillAttrs } from '@liwan/ui/app/utils/statusPill'
import RecordBlock from '@/components/pmo/records/RecordBlock.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const projectId = computed(() => parsePositiveId(route.params.id))
const milestoneId = computed(() => parsePositiveId(route.params.milestoneId))
const { data: project, error: projectError, isLoading: projectLoading, refetch: refetchProject } = useProject(projectId)
const { data: milestones, error, isLoading, refetch, complete } = useMilestones(projectId)
const denied = computed(() => [projectError.value, error.value].some(cause => cause instanceof ApiError && [403, 404].includes(cause.status)))
const milestone = computed(() => denied.value ? undefined : milestones.value?.find(item => item.id === milestoneId.value))
const notFound = computed(() => !projectId.value || !milestoneId.value || denied.value || (complete.value && !milestone.value))
const canManage = computed(() => !notFound.value && project.value?.active === true && project.value.can_manage)
const path = computed(() => `/projects/${projectId.value}/milestones/${milestoneId.value}`)
const isRecord = computed(() => route.path.replace(/\/+$/, '') === path.value)
const origins = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/milestones`])
const backTo = computed(() => owningListBack(route.query, origins.value, route.hash))
const editTo = computed(() => recordChildTo(`${path.value}/edit`, route.query, origins.value, route.hash))
const update = useUpdateMilestone()
const remove = useDeleteMilestone()
const pending = computed(() => update.isPending.value || remove.isPending.value)
const mutationError = ref<string | null>(null)
const confirmingDelete = ref(false)
function retry() { void Promise.all([refetchProject(), refetch()]) }
function failed(cause: unknown) {
  mutationError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  if (cause instanceof ApiError && cause.status === 403) void refetchProject()
}
async function patch(body: MilestonePatch) {
  if (!hydrated.value || !canManage.value || pending.value || !milestone.value || !projectId.value) return
  mutationError.value = null
  try { await update.mutateAsync({ projectId: projectId.value, id: milestone.value.id, patch: body })
    toast.add({ title: t('projects.toast.milestoneUpdated'), color: 'success' })
  }
  catch (cause) { failed(cause) }
}
function toggleDeliverable(index: number, done: boolean) {
  if (!milestone.value) return
  void patch({ deliverables: milestone.value.deliverables.map((item, current) => ({ ...item, done: current === index ? done : item.done })) })
}
async function deleteMilestone() {
  if (!canManage.value || pending.value || !milestone.value || milestone.value.task_count > 0 || !projectId.value) return
  mutationError.value = null
  try {
    await remove.mutateAsync({ projectId: projectId.value, id: milestone.value.id })
    toast.add({ title: t('projects.toast.milestoneDeleted'), color: 'success' })
    await router.replace(backTo.value)
  } catch (cause) { failed(cause) }
}
const taskPercent = computed(() => milestone.value?.task_count ? Math.round(milestone.value.done_task_count / milestone.value.task_count * 100) : 0)
const title = computed(() => milestone.value?.name ?? t('projects.milestones.name'))
// Projects › Alpha › Milestones › Kickoff. The list step carries the filters the milestone was opened from.
const trail = computed(() => [
  { label: t('nav.projects'), to: '/projects' },
  ...(project.value ? [{ label: project.value.name, to: `/projects/${project.value.id}` }] : []),
  { label: t('projects.tabs.milestones'), to: backTo.value, testId: 'milestone-detail-back' },
  { label: title.value },
])
function rename(name: string) { void patch({ name }) }
// The status chip is the status menu: mark the milestone reached, or open it again.
const stateItems = computed(() => milestone.value
  ? [[{ label: t(milestone.value.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached'), onSelect: () => patch({ is_reached: !milestone.value!.is_reached }) }]]
  : [])
const menuItems = computed(() => [
  [{ label: t('app.edit'), icon: 'i-lucide-pencil', to: editTo.value }],
  [{
    label: milestone.value && milestone.value.task_count > 0 ? t('projects.milestones.deleteBlocked', { count: milestone.value.task_count }, milestone.value.task_count) : t('projects.milestones.delete'),
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    disabled: !milestone.value || milestone.value.task_count > 0,
    onSelect: () => { confirmingDelete.value = true },
  }],
])
</script>

<template>
  <SharedRecordWorkspace
    v-if="isRecord"
    :title="title"
    :trail="trail"
    :back-to="backTo"
    :loading="(isLoading || projectLoading) && !milestone"
    :error="projectError || error"
    :keep-content="!!milestone && !notFound"
    @retry="retry"
  >
    <template v-if="milestone" #title>
      <SharedInlineText :model-value="milestone.name" :label="t('projects.milestones.editName')" :editable="canManage && hydrated && !pending" input-test-id="milestone-title-input" input-class="w-[min(32rem,70vw)]" @save="rename" />
    </template>
    <template v-if="milestone && !notFound" #status>
      <UDropdownMenu v-if="canManage" :items="stateItems" :content="{ align: 'start' }">
        <button type="button" data-testid="milestone-state" v-bind="statusPillAttrs(milestoneBadge(milestone).tone, true)" class="min-w-25 justify-center disabled:opacity-60" :disabled="!hydrated || pending">{{ t(milestoneBadge(milestone).labelKey) }}</button>
      </UDropdownMenu>
      <SharedStatusBadge v-else data-testid="milestone-state" :tone="milestoneBadge(milestone).tone" :label="t(milestoneBadge(milestone).labelKey)" />
    </template>
    <template v-if="canManage && milestone" #actions>
      <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
        <UButton data-testid="milestone-detail-menu" color="neutral" variant="ghost" size="sm" square type="button" icon="i-lucide-ellipsis" :disabled="!hydrated || pending" :aria-label="t('projects.milestones.menu')" />
      </UDropdownMenu>
    </template>
    <template #main>
      <SharedEmptyState v-if="notFound" bordered :title="t('projects.milestones.notFound')" />
      <template v-else-if="milestone">
        <UAlert v-if="mutationError" role="alert" color="error" variant="subtle" :title="mutationError" />
        <SharedInlineConfirm v-if="confirmingDelete" :title="t('projects.milestones.deleteConfirm', { name: milestone.name })" :confirm-label="t('projects.milestones.delete')" :pending="pending" @cancel="confirmingDelete = false" @confirm="deleteMilestone" />
        <RecordBlock :title="t('projects.milestones.checklistTitle')" :count="milestone.deliverables.length ? t('tasks.deliverables.checklistOf', { done: milestone.deliverables.filter(item => item.done).length, total: milestone.deliverables.length }) : undefined">
          <p v-if="!milestone.deliverables.length" class="text-sm text-muted">{{ t('projects.milestones.noDeliverables') }}</p>
          <div v-else class="grid gap-3">
            <USwitch v-for="(item, index) in milestone.deliverables" :key="index" :model-value="item.done" :label="item.name" :disabled="!hydrated || !canManage || pending || confirmingDelete" @update:model-value="value => toggleDeliverable(index, value)" />
          </div>
        </RecordBlock>
        <RecordBlock :title="t('projects.milestones.tasks')" :count="`${taskPercent}%`">
          <div class="grid justify-items-start gap-3">
            <p class="text-sm">{{ t('projects.milestones.tasksOf', { done: milestone.done_task_count, total: milestone.task_count }) }}</p>
            <SharedProgress class="w-full" size="md" :value="taskPercent" :label="t('projects.milestones.tasks')" />
            <UButton color="neutral" variant="outline" size="sm" :to="`/projects/${projectId}/tasks`">{{ t('projects.milestones.projectTasks') }}</UButton>
          </div>
        </RecordBlock>
      </template>
    </template>
    <template v-if="milestone && !notFound" #aside>
      <dl data-testid="milestone-properties" class="divide-y divide-default">
        <SharedPropertyRow :label="t('projects.milestones.startDate')" :value="formatCalendarDate(milestone.start_date)" />
        <SharedPropertyRow :label="t('projects.milestones.deadline')" :value="formatCalendarDate(milestone.deadline)" />
        <SharedPropertyRow v-if="milestone.reached_date" :label="t('projects.milestones.reached')" :value="formatCalendarDate(milestone.reached_date)" />
      </dl>
    </template>
  </SharedRecordWorkspace>
  <NuxtPage />
</template>
