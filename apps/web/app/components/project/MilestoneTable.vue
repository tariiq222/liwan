<script setup lang="ts">
import type { Milestone } from '@nasq/contracts'
import { CheckCircle2, Pencil, RotateCcw, Trash2 } from '@lucide/vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { STATUS_CHIP_CLASS, STATUS_TEXT_CLASS } from '@/utils/statusTone'
import { useDeleteMilestone, useMilestones, useUpdateMilestone } from '@/composables/useMilestones'
import { returnToQuery } from '@/utils/safeReturnTo'
import { claimMilestoneChecklistUpdate, releaseMilestoneChecklistUpdate } from '@/utils/milestoneChecklist'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

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
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

function isDeliverablePending(milestoneId: number) {
  return deliverablePending.value.has(milestoneId)
}

async function toggleDeliverable(m: Milestone, index: number, event: Event) {
  const claimed = claimMilestoneChecklistUpdate(deliverablePending.value, m.id)
  if (!claimed) return
  const checkbox = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null
  deliverablePending.value = claimed
  const current = m.deliverables ?? []
  const deliverables = current.map((item, itemIndex) => itemIndex === index ? { ...item, done: !item.done } : { ...item })
  try {
    // Checklist completion is independent from is_reached and task progress.
    await updateMutate({ projectId: props.projectId, id: m.id, patch: { deliverables } })
  } catch (e) {
    if (checkbox) checkbox.checked = !checkbox.checked
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
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
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <div class="space-y-3">
    <Card class="nasq-panel">
      <CardHeader class="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle class="text-base">{{ t('projects.tabs.milestones') }}</CardTitle>
          <CardDescription>{{ t('projects.milestones.emptyHint') }}</CardDescription>
        </div>
      </CardHeader>
      <CardContent class="p-0">
        <div v-if="isLoading || !hydrated" class="space-y-3 p-[18px]">
          <Skeleton v-for="n in 3" :key="n" class="h-14 w-full" />
        </div>
        <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
        <div v-else-if="items.length === 0" class="p-8 text-center">
          <p class="font-medium">{{ t('projects.milestones.empty') }}</p>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('projects.milestones.emptyHint') }}</p>
        </div>
        <div v-else class="divide-y">
          <div v-for="m in items" :key="m.id" data-testid="milestone-row" class="flex flex-col gap-3 px-[18px] py-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-medium">{{ m.name }}</p>
                <Badge variant="outline" :class="STATUS_CHIP_CLASS[m.is_reached ? 'success' : 'neutral']">{{ t(m.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached') }}</Badge>
              </div>
              <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{{ t('projects.milestones.startDate') }}: {{ startText(m) }}</span>
                <span :class="STATUS_TEXT_CLASS[deadlineTone(m)]">{{ t('projects.milestones.deadline') }}: {{ deadlineText(m) }}</span>
                <span>{{ t('projects.milestones.tasksOf', { done: m.done_task_count, total: m.task_count }) }}</span>
                <span>{{ t('projects.milestones.taskProgress', { percent: taskProgress(m) }) }}</span>
                <span v-if="m.deliverables?.length">{{ t('projects.milestones.checklistOf', { done: m.deliverables.filter(item => item.done).length, total: m.deliverables.length }) }}</span>
              </div>
              <div v-if="m.deliverables?.length" class="mt-3 space-y-1.5">
                <label v-for="(item, index) in m.deliverables" :key="`${m.id}-${index}`" class="flex items-center gap-2 text-sm">
                  <input type="checkbox" :checked="item.done" :disabled="!hydrated || !canManage || isDeliverablePending(m.id)" class="size-4 rounded border-border accent-primary" @change="toggleDeliverable(m, index, $event)" />
                  <span :class="item.done ? 'text-muted-foreground line-through' : ''">{{ item.name }}</span>
                </label>
              </div>
            </div>
            <div v-if="canManage" class="flex shrink-0 flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" class="gap-1.5" :disabled="!hydrated" @click="toggleReached(m)">
                <RotateCcw v-if="m.is_reached" class="size-4" /><CheckCircle2 v-else class="size-4" />{{ t(m.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached') }}
              </Button>
              <Button variant="ghost" size="sm" class="gap-1.5" :disabled="!hydrated" @click="openEdit(m)"><Pencil class="size-4" />{{ t('projects.milestones.edit') }}</Button>
              <TooltipProvider v-if="m.task_count > 0" :delay-duration="0">
                <Tooltip>
                  <TooltipTrigger as-child><span><Button variant="ghost" size="icon" class="size-8" disabled><Trash2 class="size-4" /></Button></span></TooltipTrigger>
                  <TooltipContent>{{ t('projects.milestones.hasTasks', { count: m.task_count }) }}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button v-else variant="ghost" size="icon" class="size-8 text-destructive" :disabled="!hydrated" :aria-label="t('projects.milestones.delete')" @click="deleteTarget = m"><Trash2 class="size-4" /></Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <div v-if="deleteTarget" data-testid="milestone-delete-confirm" class="nasq-status-callout-danger space-y-2 p-3 text-sm">
      <p class="font-medium">{{ t('projects.milestones.delete') }}</p>
      <p class="text-muted-foreground">{{ deleteTarget.name }}</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" type="button" :disabled="deleting" @click="deleteTarget = null">{{ t('app.cancel') }}</Button>
        <Button variant="destructive" type="button" :disabled="deleting" @click="confirmDelete">{{ t('projects.milestones.delete') }}</Button>
      </div>
    </div>
  </div>
</template>
