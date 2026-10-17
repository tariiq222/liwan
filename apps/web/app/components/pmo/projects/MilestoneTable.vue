<script setup lang="ts">
import type { Milestone } from '@webvue/contracts'
import { getLocalTimeZone, today } from '@internationalized/date'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, toCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import type { TableColumn } from '@nuxt/ui'
import { useDeleteMilestone, useMilestones, useUpdateMilestone } from '@/composables/useMilestones'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const projectIdRef = computed(() => props.projectId)
const { data, isLoading, error, refetch } = useMilestones(projectIdRef)
const items = computed<Milestone[]>(() => data.value ?? [])
const route = useRoute()

function detailTo(m: Milestone) {
  return { path: `/projects/${props.projectId}/milestones/${m.id}`, query: returnToQuery(route.fullPath) }
}

function editTo(m: Milestone) {
  return { path: `/projects/${props.projectId}/milestones/${m.id}/edit`, query: { listOrigin: route.fullPath } }
}

// A milestone with linked tasks cannot be deleted; the menu item stays visible,
// disabled, and names the reason.
function milestoneActions(m: Milestone): RowAction[] {
  return [
    {
      label: t(m.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached'),
      icon: m.is_reached ? 'i-lucide-rotate-ccw' : 'i-lucide-circle-check',
      onSelect: () => { void toggleReached(m) },
    },
    { label: t('projects.milestones.edit'), icon: 'i-lucide-pencil', to: editTo(m) },
    {
      label: m.task_count > 0 ? t('projects.milestones.deleteBlocked', { count: m.task_count }, m.task_count) : t('projects.milestones.delete'),
      icon: 'i-lucide-trash-2',
      destructive: true,
      disabled: m.task_count > 0,
      onSelect: () => { deleteId.value = m.id },
    },
  ]
}

// --- deadline tone ---------------------------------------------------------
// A milestone deadline is a calendar date, not an instant (see
// calendarDate.ts) — comparing it against `today()` in the viewer's own
// timezone avoids the UTC-midnight shift `new Date(...)` would introduce.
function isPastDeadline(deadline: string | null): boolean {
  const d = toCalendarDate(deadline)
  if (!d) return false
  return d.compare(today(getLocalTimeZone())) < 0
}
function deadlineTone(m: Milestone): 'destructive' | 'neutral' {
  return !m.is_reached && isPastDeadline(m.deadline) ? 'destructive' : 'neutral'
}
const DEADLINE_TEXT_CLASS: Record<'destructive' | 'neutral', string> = {
  destructive: 'text-error', neutral: '',
}
function deadlineText(m: Milestone): string {
  return m.deadline ? formatCalendarDate(m.deadline, locale.value) : '—'
}
function startText(m: Milestone): string {
  return m.start_date ? formatCalendarDate(m.start_date, locale.value) : '—'
}
function taskProgress(m: Milestone): number {
  if (!m.task_count) return 0
  return Math.round((m.done_task_count / m.task_count) * 100)
}

// --- mark reached / reopen --------------------------------------------------
const { mutateAsync: updateMutate } = useUpdateMilestone()
async function toggleReached(m: Milestone) {
  try {
    await updateMutate({ projectId: props.projectId, id: m.id, patch: { is_reached: !m.is_reached } })
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}

// --- delete ------------------------------------------------------------
const { mutateAsync: deleteMutate, isPending: deleting } = useDeleteMilestone()
const deleteId = ref<number | null>(null)
const deleteTarget = computed(() => items.value.find(m => m.id === deleteId.value) ?? null)

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteMutate({ projectId: props.projectId, id: deleteTarget.value.id })
    deleteId.value = null
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}
const columns = computed<TableColumn<Milestone>[]>(() => [
  { id: 'number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12', td: 'w-12' } } },
  { id: 'name', header: t('projects.milestones.name') },
  { id: 'state', header: t('projects.milestones.state') },
  { id: 'start', header: t('projects.milestones.startDate') },
  { id: 'deadline', header: t('projects.milestones.deadline') },
  { id: 'tasks', header: t('projects.milestones.tasks') },
  ...(props.canManage ? [{ id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
</script>

<template>
  <div class="grid min-w-0 gap-(--webvue-gap-card)" data-testid="milestone-table">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <SharedEmptyState
      v-else-if="hydrated && !isLoading && items.length === 0"
      bordered
      :title="t('projects.milestones.empty')"
      :description="t('projects.milestones.emptyHint')"
    />
    <template v-else>
      <SharedInlineConfirm
        v-if="deleteTarget"
        data-testid="milestone-delete-confirm"
        :title="t('projects.milestones.deleteConfirm', { name: deleteTarget.name })"
        :confirm-label="t('projects.milestones.delete')"
        :pending="deleting"
        @cancel="deleteId = null"
        @confirm="confirmDelete"
      />
      <SharedListCard>
        <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="isLoading || !hydrated" :caption="t('projects.tabs.milestones')">
          <template #number-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #name-cell="{ row }">
            <div data-testid="milestone-row" class="grid min-w-0 gap-1">
              <NuxtLink :to="detailTo(row.original)" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</NuxtLink>
              <span v-if="row.original.deliverables?.length" class="text-xs text-muted">{{ t('projects.milestones.checklistOf', { done: row.original.deliverables.filter(item => item.done).length, total: row.original.deliverables.length }) }}</span>
            </div>
          </template>
          <template #state-cell="{ row }">
            <SharedStatusBadge :tone="row.original.is_reached ? 'success' : 'neutral'" :label="t(row.original.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached')" />
          </template>
          <template #start-cell="{ row }">{{ startText(row.original) }}</template>
          <template #deadline-cell="{ row }"><span :class="DEADLINE_TEXT_CLASS[deadlineTone(row.original)]">{{ deadlineText(row.original) }}</span></template>
          <template #tasks-cell="{ row }">
            <div class="grid min-w-32 gap-1">
              <span class="text-sm">{{ t('projects.milestones.tasksOf', { done: row.original.done_task_count, total: row.original.task_count }) }}</span>
              <SharedProgress size="sm" :value="taskProgress(row.original)" :label="t('projects.milestones.taskProgress', { percent: taskProgress(row.original) })" />
            </div>
          </template>
          <template #actions-cell="{ row }">
            <div data-testid="milestone-actions">
              <SharedRowActions :actions="milestoneActions(row.original)" :label="t('projects.milestones.actionsNamed', { name: row.original.name })" />
            </div>
          </template>
          <template #mobile-row="{ row: m }">
            <div data-testid="milestone-card" class="grid gap-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <NuxtLink :to="detailTo(m)" class="font-medium text-highlighted hover:underline">{{ m.name }}</NuxtLink>
                  <SharedStatusBadge class="mt-1" :tone="m.is_reached ? 'success' : 'neutral'" :label="t(m.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached')" />
                </div>
                <div v-if="canManage" data-testid="milestone-actions-card" class="shrink-0">
                  <SharedRowActions :actions="milestoneActions(m)" :label="t('projects.milestones.actionsNamed', { name: m.name })" />
                </div>
              </div>
              <SharedProgress size="sm" :value="taskProgress(m)" :label="t('projects.milestones.taskProgress', { percent: taskProgress(m) })" />
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>{{ t('projects.milestones.startDate') }}: {{ startText(m) }}</span>
                <span :class="DEADLINE_TEXT_CLASS[deadlineTone(m)]">{{ t('projects.milestones.deadline') }}: {{ deadlineText(m) }}</span>
                <span>{{ t('projects.milestones.tasksOf', { done: m.done_task_count, total: m.task_count }) }}</span>
                <span>{{ t('projects.milestones.taskProgress', { percent: taskProgress(m) }) }}</span>
                <span v-if="m.deliverables?.length">{{ t('projects.milestones.checklistOf', { done: m.deliverables.filter(item => item.done).length, total: m.deliverables.length }) }}</span>
              </div>
            </div>
          </template>
        </SharedDataTable>
      </SharedListCard>
    </template>
  </div>
</template>
