<script setup lang="ts">
import type { MilestonePatch } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useMilestones, useUpdateMilestone, useDeleteMilestone } from '@/composables/useMilestones'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { parsePositiveId } from '@/utils/routeParams'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => parsePositiveId(route.params.id))
const milestoneId = computed(() => parsePositiveId(route.params.milestoneId))
const { data: project, error: projectError, isLoading: projectLoading, refetch: refetchProject } = useProject(projectId)
const { data: milestones, error, isLoading, refetch } = useMilestones(projectId)
const denied = computed(() => [projectError.value, error.value].some(cause => cause instanceof ApiError && [403, 404].includes(cause.status)))
const milestone = computed(() => denied.value ? undefined : milestones.value?.find(item => item.id === milestoneId.value))
const notFound = computed(() => !projectId.value || !milestoneId.value || denied.value || (!isLoading.value && !!milestones.value && !milestone.value))
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
  try { await update.mutateAsync({ projectId: projectId.value, id: milestone.value.id, patch: body }) }
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
    await router.replace(backTo.value)
  } catch (cause) { failed(cause) }
}
</script>

<template>
  <SharedRecordPage v-if="isRecord" :title="milestone?.name ?? t('projects.milestones.name')" :back-to="backTo" :back-label="t('projects.tabs.milestones')" :loading="(isLoading || projectLoading) && !milestone" :error="projectError || error" :keep-content="!!milestone && !notFound" @retry="retry">
    <template #back><UButton :to="backTo" data-testid="milestone-detail-back" color="neutral" variant="ghost" icon="i-lucide-arrow-right" class="ltr:[&_svg]:rotate-180">{{ t('projects.tabs.milestones') }}</UButton></template>
    <template v-if="canManage && milestone" #actions>
      <UButton data-testid="milestone-detail-edit" :to="editTo" :disabled="!hydrated || pending">{{ t('app.edit') }}</UButton>
      <UButton color="neutral" variant="outline" :disabled="!hydrated || pending" @click="patch({ is_reached: !milestone.is_reached })">{{ t(milestone.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached') }}</UButton>
      <UButton color="error" variant="outline" :disabled="!hydrated || pending || milestone.task_count > 0" :title="milestone.task_count > 0 ? t('projects.milestones.deleteBlocked', { count: milestone.task_count }, milestone.task_count) : undefined" @click="confirmingDelete = true">{{ t('projects.milestones.delete') }}</UButton>
    </template>
    <SharedEmptyState v-if="notFound" bordered :title="t('projects.milestones.notFound')" />
    <template v-else-if="milestone">
      <UAlert v-if="mutationError" role="alert" color="error" variant="subtle" :title="mutationError" />
      <SharedInlineConfirm v-if="confirmingDelete" :title="t('projects.milestones.deleteConfirm', { name: milestone.name })" :confirm-label="t('projects.milestones.delete')" :pending="pending" @cancel="confirmingDelete = false" @confirm="deleteMilestone" />
      <SharedRecordSection variant="panel" :title="t('projects.milestones.checklistTitle')" :description="t('projects.milestones.checklistHint')">
        <p v-if="!milestone.deliverables.length" class="text-sm text-muted">{{ t('projects.milestones.noDeliverables') }}</p>
        <div v-else class="grid gap-3">
          <USwitch v-for="(item, index) in milestone.deliverables" :key="index" :model-value="item.done" :label="item.name" :disabled="!hydrated || !canManage || pending || confirmingDelete" @update:model-value="value => toggleDeliverable(index, value)" />
        </div>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('projects.milestones.tasks')" :description="t('projects.milestones.taskProgress', { percent: milestone.task_count ? Math.round(milestone.done_task_count / milestone.task_count * 100) : 0 })">
        <div class="grid justify-items-start gap-3">
          <p class="text-sm">{{ t('projects.milestones.tasksOf', { done: milestone.done_task_count, total: milestone.task_count }) }}</p>
          <SharedProgress class="w-full" size="md" :value="milestone.task_count ? Math.round(milestone.done_task_count / milestone.task_count * 100) : 0" :label="t('projects.milestones.tasks')" />
          <UButton color="neutral" variant="outline" :to="`/projects/${projectId}/tasks`">{{ t('projects.milestones.projectTasks') }}</UButton>
        </div>
      </SharedRecordSection>
    </template>
    <template v-if="milestone && !notFound" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.milestones.state')">
          <SharedStatusBadge :tone="milestone.is_reached ? 'success' : 'neutral'" :label="t(milestone.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached')" />
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.milestones.startDate')" :value="formatCalendarDate(milestone.start_date, locale)" />
        <SharedPropertyRow :label="t('projects.milestones.deadline')" :value="formatCalendarDate(milestone.deadline, locale)" />
        <SharedPropertyRow v-if="milestone.reached_date" :label="t('projects.milestones.reached')" :value="formatCalendarDate(milestone.reached_date, locale)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
