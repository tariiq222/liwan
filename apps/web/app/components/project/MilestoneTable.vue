<script setup lang="ts">
import type { Milestone } from '@nasq/contracts'
import { getLocalTimeZone, today } from '@internationalized/date'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { TONE_BADGE_COLOR } from '@/components/project/projectTone'
import { useDeleteMilestone, useMilestones, useUpdateMilestone } from '@/composables/useMilestones'
import { returnToQuery } from '@/utils/safeReturnTo'
import { claimMilestoneChecklistUpdate, releaseMilestoneChecklistUpdate } from '@/utils/milestoneChecklist'

const props = defineProps<{ projectId: number; canManage: boolean; embedded?: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const projectIdRef = computed(() => props.projectId)
const { data, isLoading, error, refetch } = useMilestones(projectIdRef)
const items = computed<Milestone[]>(() => data.value ?? [])
const router = useRouter()
const route = useRoute()
const deliverablePending = ref(new Set<number>())

function openEdit(m: Milestone) {
  router.push({ path: `/projects/${props.projectId}/milestones/${m.id}/edit`, query: returnToQuery(route.fullPath) })
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

function isDeliverablePending(milestoneId: number) {
  return deliverablePending.value.has(milestoneId)
}

async function toggleDeliverable(m: Milestone, index: number, next: boolean) {
  const claimed = claimMilestoneChecklistUpdate(deliverablePending.value, m.id)
  if (!claimed) return
  deliverablePending.value = claimed
  const current = m.deliverables ?? []
  const deliverables = current.map((item, itemIndex) => itemIndex === index ? { ...item, done: next } : { ...item })
  try {
    // Checklist completion is independent from is_reached and task progress.
    // USwitch's display always derives from `item.done`; a failed mutation
    // leaves that value untouched, so no manual DOM revert is needed here.
    await updateMutate({ projectId: props.projectId, id: m.id, patch: { deliverables } })
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  } finally {
    deliverablePending.value = releaseMilestoneChecklistUpdate(deliverablePending.value, m.id)
  }
}

// --- delete ------------------------------------------------------------
const { mutateAsync: deleteMutate, isPending: deleting } = useDeleteMilestone()
const deleteTarget = ref<Milestone | null>(null)

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteMutate({ projectId: props.projectId, id: deleteTarget.value.id })
    deleteTarget.value = null
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-3">
    <UCard :ui="{ body: 'p-0' }">
      <template v-if="!embedded" #header>
        <div>
          <h2 class="text-lg font-semibold text-highlighted">{{ t('projects.tabs.milestones') }}</h2>
          <p class="text-sm text-muted">{{ t('projects.milestones.emptyHint') }}</p>
        </div>
      </template>
      <div v-if="isLoading || !hydrated" class="space-y-3 p-[18px]">
        <USkeleton v-for="n in 3" :key="n" class="h-14 w-full" />
      </div>
      <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
      <div v-else-if="items.length === 0" class="p-8 text-center">
        <p class="font-medium text-highlighted">{{ t('projects.milestones.empty') }}</p>
        <p class="mt-1 text-sm text-muted">{{ t('projects.milestones.emptyHint') }}</p>
      </div>
      <div v-else class="milestone-list divide-y divide-default">
        <div v-for="m in items" :key="m.id" data-testid="milestone-row" class="milestone-row flex flex-col gap-3 px-[18px] py-4">
          <div class="milestone-main min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">{{ m.name }}</p>
              <UBadge variant="subtle" :color="TONE_BADGE_COLOR[m.is_reached ? 'success' : 'neutral']">{{ t(m.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached') }}</UBadge>
            </div>
            <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>{{ t('projects.milestones.startDate') }}: {{ startText(m) }}</span>
              <span :class="DEADLINE_TEXT_CLASS[deadlineTone(m)]">{{ t('projects.milestones.deadline') }}: {{ deadlineText(m) }}</span>
              <span>{{ t('projects.milestones.tasksOf', { done: m.done_task_count, total: m.task_count }) }}</span>
              <span>{{ t('projects.milestones.taskProgress', { percent: taskProgress(m) }) }}</span>
              <span v-if="m.deliverables?.length">{{ t('projects.milestones.checklistOf', { done: m.deliverables.filter(item => item.done).length, total: m.deliverables.length }) }}</span>
            </div>
            <div v-if="m.deliverables?.length" class="mt-3 space-y-1.5">
              <label v-for="(item, index) in m.deliverables" :key="`${m.id}-${index}`" class="flex items-center gap-2 text-sm">
                <USwitch :model-value="item.done" :disabled="!hydrated || !canManage || isDeliverablePending(m.id)" :aria-label="item.name" @update:model-value="value => toggleDeliverable(m, index, value)" />
                <span :class="item.done ? 'text-muted line-through' : ''">{{ item.name }}</span>
              </label>
            </div>
          </div>
          <div v-if="canManage" class="milestone-actions flex w-full shrink-0 flex-wrap items-center gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :icon="m.is_reached ? 'i-lucide-rotate-ccw' : 'i-lucide-check-circle-2'"
              :disabled="!hydrated"
              :label="t(m.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached')"
              @click="toggleReached(m)"
            />
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" :disabled="!hydrated" :label="t('projects.milestones.edit')" @click="openEdit(m)" />
            <UTooltip v-if="m.task_count > 0" :text="t('projects.milestones.hasTasks', { count: m.task_count })" :delay-duration="0">
              <span><UButton color="neutral" variant="ghost" square icon="i-lucide-trash-2" disabled /></span>
            </UTooltip>
            <UButton v-else color="error" variant="ghost" square icon="i-lucide-trash-2" :disabled="!hydrated" :aria-label="t('projects.milestones.delete')" @click="deleteTarget = m" />
          </div>
        </div>
      </div>
    </UCard>

    <UAlert v-if="deleteTarget" color="error" variant="soft" data-testid="milestone-delete-confirm" :title="t('projects.milestones.delete')" :description="deleteTarget.name">
      <template #actions>
        <UButton color="neutral" variant="outline" type="button" :disabled="deleting" :label="t('app.cancel')" @click="deleteTarget = null" />
        <UButton color="error" type="button" :disabled="deleting" :label="t('projects.milestones.delete')" @click="confirmDelete" />
      </template>
    </UAlert>
  </div>
</template>

<style scoped>
.milestone-list {
  container-type: inline-size;
}

@container (min-width: 52rem) {
  .milestone-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .milestone-actions {
    width: auto;
    justify-content: flex-end;
  }
}
</style>
