<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { CalendarDate, parseDate } from '@internationalized/date'
import { formatNasqDate, formatNasqDateTime } from '@/composables/calendarDate'
import { usePersonalStages } from '@/composables/usePersonalStages'
import { useUpdateTask } from '@/composables/useTasks'
import { useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'
import { validateTaskDates } from '@/utils/projectDateBounds'
import { sectionTabsUi } from '@/utils/sectionTabs'
import AssigneePicker from './AssigneePicker.vue'
import DependencyPicker from './DependencyPicker.vue'
import TaskActivity from './TaskActivity.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskDescription from './TaskDescription.vue'
import TaskDeliverables from './TaskDeliverables.vue'
import MilestoneSelect from './MilestoneSelect.vue'
import PrioritySelect from './PrioritySelect.vue'
import SubtaskList from './SubtaskList.vue'
import TagPicker from './TagPicker.vue'

const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutate: updateTask } = useUpdateTask()
const { data: stages } = usePersonalStages()
const projectId = computed(() => props.task.project?.id ?? null)
const { data: milestones } = useMilestones(projectId)
const tabs = computed(() => [
  { label: t('tasks.drawer.details'), value: 'details', slot: 'details', disabled: !hydrated.value },
  { label: t('tasks.detail.commentsTitle'), value: 'comments', slot: 'comments', disabled: !hydrated.value },
  { label: t('tasks.detail.logTitle'), value: 'log', slot: 'log', disabled: !hydrated.value },
  { label: t('tasks.drawer.subtasks'), value: 'subtasks', slot: 'subtasks', disabled: !hydrated.value },
  { label: t('tasks.drawer.attachments'), value: 'attachments', slot: 'attachments', disabled: !hydrated.value },
  { label: t('taskLifecycle.dependencies'), value: 'dependencies', slot: 'dependencies', disabled: !hydrated.value },
])
const { data: project } = useProject(projectId)
// The details tab stacks its sections as rows: title in the start column, content beside it.
const rowClass = 'grid gap-x-8 gap-y-4 py-6 first:pt-2 last:pb-0 lg:grid-cols-[11rem_minmax(0,1fr)]'
const rowTitleClass = 'text-sm font-semibold text-highlighted'
const deadlineError = ref<string | null>(null)
const selectedMilestone = computed(() => {
  const milestoneId = props.task.milestone?.id
  return milestones.value?.find(item => item.id === milestoneId)
})
const milestoneStart = computed(() => selectedMilestone.value?.start_date ?? project.value?.date_start ?? null)
const milestoneDeadline = computed(() => selectedMilestone.value?.deadline ?? project.value?.date_end ?? null)

function patch(body: Parameters<typeof updateTask>[0]['patch'], resolved?: Parameters<typeof updateTask>[0]['resolved']) {
  if (props.task.can_write) updateTask({ id: props.task.id, patch: body, resolved })
}

// --- assignees -------------------------------------------------------
function onAssigneesChange({ ids, resolved }: { ids: number[]; resolved: TaskDetail['assignees'] }) {
  patch({ user_ids: ids }, { assignees: resolved })
}

// --- tags --------------------------------------------------------------
function onTagsChange({ ids, resolved }: { ids: number[]; resolved: TaskDetail['tags'] }) {
  patch({ tag_ids: ids }, { tags: resolved })
}

// --- formatters ----------------------------------------------------------
// Driven by the active locale, never a hardcoded 'ar-SA': V8 resolves ar-SA
// to the Umm al-Qura (Hijri) calendar, so every date here rendered Hijri in
// *both* locales by accident. `calendar: 'gregory'` pins the calendar system
// explicitly so an Arabic locale still gets Gregorian dates (with
// Arabic-Indic digits). Timeline.vue already follows this pattern.
const dateFmt = computed(() => ({ format: (value: Date) => formatNasqDate(value, locale.value) }))
const dateTimeFmt = computed(() => ({ format: (value: Date) => formatNasqDateTime(value, locale.value) }))

// --- deadline ------------------------------------------------------------
// Contract: a deadline is a UTC *instant* (the API stores/returns an ISO
// `...Z` string). Everything below therefore converts once, at the boundary:
// reads project that instant into the viewer's local zone, and the write
// converts the viewer's local wall clock back to an instant. Previously the
// button label was formatted in the local zone while the calendar highlight
// and the time input were sliced out of the raw UTC string, so on either side
// of midnight the two disagreed — and the write stamped the local wall clock
// with a literal 'Z', shifting the saved instant by the whole tz offset.
const deadlineInstant = computed(() => {
  if (!props.task.date_deadline) return null
  const d = new Date(props.task.date_deadline)
  return Number.isNaN(d.getTime()) ? null : d
})

const calendarValue = computed(() => {
  const d = deadlineInstant.value
  if (!d) return undefined
  return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
})

function localTimeOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const timeDraft = ref(deadlineInstant.value ? localTimeOf(deadlineInstant.value) : '09:00')
watch(deadlineInstant, (d) => {
  if (d) timeDraft.value = localTimeOf(d)
})

const deadlineButtonLabel = computed(() =>
  deadlineInstant.value ? dateFmt.value.format(deadlineInstant.value) : t('tasks.deadline.none'),
)

function setDeadline(date: CalendarDate | undefined, time: string) {
  if (!date) return
  const [rawHours = '0', rawMinutes = '0'] = time.split(':')
  const hours = Number(rawHours)
  const minutes = Number(rawMinutes)
  const local = new Date(
    date.year, date.month - 1, date.day,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0, 0,
  )
  const dateDeadline = `${local.toISOString().slice(0, 19)}Z`
  const boundsError = validateTaskDates({
    milestoneStart: milestoneStart.value,
    milestoneDeadline: milestoneDeadline.value,
    plannedStart: props.task.planned_start,
    dateDeadline,
  })
  if (boundsError) {
    deadlineError.value = t(`tasks.schedule.${boundsError.split('.').pop()}`)
    return
  }
  deadlineError.value = null
  // Second precision: toISOString() emits milliseconds, and the API's
  // contract shape (serializers/common.py::iso) has none.
  patch({ date_deadline: `${local.toISOString().slice(0, 19)}Z` })
}

function onDeadlineDateChange(value: string | null) {
  if (value === null) clearDeadline()
  else setDeadline(parseDate(value), timeDraft.value)
}
function onTimeChange() {
  setDeadline(calendarValue.value, timeDraft.value)
}
function clearDeadline() {
  deadlineError.value = null
  patch({ date_deadline: null })
}

// --- personal stage ----------------------------------------------------
const NONE = 'none'
function onStageChange(value: unknown) {
  if (value === NONE) {
    patch({ personal_stage_type_id: null }, { personal_stage: null })
    return
  }
  const id = Number(value)
  const stage = (stages.value ?? []).find((s) => s.id === id)
  if (!stage) return
  patch({ personal_stage_type_id: id }, { personal_stage: { id: stage.id, name: stage.name } })
}

// --- allocated hours (managers only) ------------------------------------
const hoursDraft = ref(String(props.task.allocated_hours))
watch(
  () => props.task.allocated_hours,
  (v) => {
    hoursDraft.value = String(v)
  },
)
function onHoursChange() {
  const n = Number(hoursDraft.value)
  if (!Number.isFinite(n) || n === props.task.allocated_hours) return
  patch({ allocated_hours: n })
}

// --- metrics ---------------------------------------------------------------
const createdLabel = computed(() => dateTimeFmt.value.format(new Date(props.task.created_at)))
const updatedLabel = computed(() => dateTimeFmt.value.format(new Date(props.task.updated_at)))
const completedSubtasks = computed(() => props.task.subtasks.filter(subtask => subtask.is_closed).length)
</script>

<template>
  <UTabs
    data-testid="task-detail-tabs"
    variant="link"
    :ui="sectionTabsUi"
    :items="tabs"
    default-value="details"
    :unmount-on-hide="false"
    :aria-label="t('tasks.detail.sections')"
    class="min-w-0"
  >
    <template #details>
      <div class="divide-y divide-default">
        <section :class="rowClass" aria-labelledby="task-section-assignment">
          <h2 id="task-section-assignment" :class="rowTitleClass">{{ t('tasks.detail.sectionAssignment') }}</h2>
          <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2" role="group" :aria-label="t('tasks.detail.primaryMetadata')">
            <div class="min-w-0">
              <span id="task-assignees-label" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-users" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.assignees') }}</span>
              <p v-if="!task.can_write" class="block wrap-anywhere text-sm font-medium text-highlighted">{{ task.assignees.map(person => person.name).join('، ') || t('tasks.drawer.unassigned') }}</p>
              <AssigneePicker v-else :model-value="task.assignees" labelledby="task-assignees-label" @update:model-value="onAssigneesChange" />
            </div>

            <div class="min-w-0">
              <span id="task-priority-label" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-flag" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.priority') }}</span>
              <PrioritySelect :task="task" labelledby="task-priority-label" variant="outline" />
            </div>

            <div class="min-w-0">
              <span id="task-deadline-label" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-calendar" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.deadline') }}</span>
              <p v-if="!task.can_write" class="block wrap-anywhere text-sm font-medium text-highlighted">{{ deadlineButtonLabel }}</p>
              <SharedDateField
                v-else
                id="task-deadline"
                :model-value="calendarValue?.toString() ?? null"
                :label="deadlineInstant ? deadlineButtonLabel : undefined"
                :min-value="milestoneStart"
                :max-value="milestoneDeadline"
                :aria-label="t('tasks.drawer.deadline')"
                @update:model-value="onDeadlineDateChange"
              >
                <template #footer>
                  <label for="deadline-time" class="sr-only">{{ t('tasks.drawer.deadlineTime') }}</label>
                  <UInput id="deadline-time" v-model="timeDraft" type="time" class="me-auto w-32" :disabled="!hydrated" @change="onTimeChange" />
                </template>
              </SharedDateField>
              <p v-if="deadlineError" role="alert" class="mt-1 text-xs text-error">{{ deadlineError }}</p>
            </div>

            <div class="min-w-0">
              <span id="task-milestone-label" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-milestone" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.milestone') }}</span>
              <MilestoneSelect v-if="task.project && task.can_write" :task="task" labelledby="task-milestone-label" />
              <p v-else class="block wrap-anywhere text-sm font-medium text-highlighted">{{ task.milestone?.name || t('tasks.drawer.noMilestone') }}</p>
            </div>
          </div>
        </section>

        <section :class="rowClass" aria-labelledby="task-section-organization">
          <h2 id="task-section-organization" :class="rowTitleClass">{{ t('tasks.detail.sectionOrganization') }}</h2>
          <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <div class="min-w-0">
              <span id="task-stage-label" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-inbox" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.stage') }}</span>
              <p v-if="!task.can_write" class="block wrap-anywhere text-sm font-medium text-highlighted">{{ task.personal_stage?.name || t('tasks.drawer.unassigned') }}</p>
              <USelect
                v-else
                size="sm"
                class="w-full"
                aria-labelledby="task-stage-label"
                :items="[{ label: t('tasks.drawer.unassigned'), value: NONE }, ...(stages ?? []).map((s) => ({ label: s.name, value: String(s.id) }))]"
                :model-value="task.personal_stage ? String(task.personal_stage.id) : NONE"
                @update:model-value="onStageChange"
              />
            </div>

            <div v-if="task.can_write && task.can_approve" class="min-w-0">
              <label for="allocated-hours" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-clock" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.allocatedHours') }}</label>
              <UInput id="allocated-hours" v-model="hoursDraft" type="number" min="0" step="0.5" size="sm" class="w-full" @change="onHoursChange" />
            </div>

            <div class="min-w-0 sm:col-span-2">
              <span id="task-tags-label" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><UIcon name="i-lucide-tag" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />{{ t('tasks.drawer.tags') }}</span>
              <p v-if="!task.can_write" class="block wrap-anywhere text-sm font-medium text-highlighted">{{ task.tags.map(tag => tag.name).join('، ') || '—' }}</p>
              <TagPicker v-else :model-value="task.tags" :can-create="task.can_approve" labelledby="task-tags-label" @update:model-value="onTagsChange" />
            </div>
          </div>
        </section>

        <section :class="rowClass" aria-labelledby="task-description-title">
          <h2 id="task-description-title" :class="rowTitleClass">{{ t('tasks.drawer.description') }}</h2>
          <TaskDescription :key="task.id" :task="task" />
        </section>

        <TaskDeliverables :key="`outputs-${task.id}`" :task="task" :class="rowClass" />

        <section :class="rowClass" aria-labelledby="task-section-metrics">
          <h2 id="task-section-metrics" :class="rowTitleClass">{{ t('tasks.drawer.metrics') }}</h2>
          <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.created') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ createdLabel }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.updated') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ updatedLabel }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.age') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ t('tasks.drawer.days', { n: task.age_days }) }}</dd>
            </div>
            <div v-if="task.cycle_days !== null" class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.cycle') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ t('tasks.drawer.days', { n: task.cycle_days }) }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>

    <template #comments>
      <TaskActivity :task="task" mode="comments" />
    </template>

    <template #log>
      <TaskActivity :task="task" mode="log" />
    </template>

    <template #subtasks>
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold text-highlighted">{{ t('tasks.drawer.subtasks') }}</h2>
          <span class="text-xs font-normal text-muted">{{ t('tasks.detail.subtaskProgress', { done: completedSubtasks, total: task.subtasks.length }) }}</span>
        </div>
        <SubtaskList :task="task" :base-path="props.basePath" />
      </section>
    </template>

    <template #attachments>
      <TaskAttachments :key="task.id" :task-id="task.id" :can-write="task.can_write" />
    </template>

    <template #dependencies>
      <DependencyPicker :task="task" />
    </template>
  </UTabs>
</template>
