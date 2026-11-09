<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { TaskDetail } from '@liwan/contracts'
import { CalendarDate, parseDate } from '@internationalized/date'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { useUpdateTask } from '@/composables/useTasks'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'
import { validateTaskDates } from '@/utils/projectDateBounds'
import AssigneePicker from './AssigneePicker.vue'
import MilestoneSelect from './MilestoneSelect.vue'
import PrioritySelect from './PrioritySelect.vue'
import TagPicker from '@/components/shared/form/TagPicker.vue'
const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutate: updateTask } = useUpdateTask()
const projectId = computed(() => props.task.planning_enabled ? props.task.project?.id ?? null : null)
const { data: milestones } = useMilestones(projectId)
const { data: project } = useProject(projectId)
const deadlineError = ref<string | null>(null)
const selectedMilestone = computed(() => {
  const milestoneId = props.task.milestone?.id
  return milestones.value?.find(item => item.id === milestoneId)
})
const milestoneStart = computed(() => props.task.planning_enabled ? selectedMilestone.value?.start_date ?? project.value?.date_start ?? null : null)
const milestoneDeadline = computed(() => props.task.planning_enabled ? selectedMilestone.value?.deadline ?? project.value?.date_end ?? null : null)

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
const dateFmt = computed(() => ({ format: (value: Date) => formatLiwanDate(value) }))

// --- record facts --------------------------------------------------------
const createdLabel = computed(() => formatLiwanDateTime(props.task.created_at))
const updatedLabel = computed(() => formatLiwanDateTime(props.task.updated_at))

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
  // Second precision: toISOString() emits milliseconds, and the API's contract shape (serializers/common.py::iso) has none.
  const dateDeadline = `${local.toISOString().slice(0, 19)}Z`
  const boundsError = props.task.planning_enabled ? validateTaskDates({
    milestoneStart: milestoneStart.value,
    milestoneDeadline: milestoneDeadline.value,
    plannedStart: props.task.planned_start,
    dateDeadline,
  }) : null
  if (boundsError) {
    deadlineError.value = t(`tasks.schedule.${boundsError.split('.').pop()}`)
    return
  }
  deadlineError.value = null
  patch({ date_deadline: dateDeadline })
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

// --- allocated hours (managers only) ------------------------------------
// The field is min=0: a negative or non-numeric entry is dropped and the saved value stays.
function onHoursSave(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n === props.task.allocated_hours) return
  patch({ allocated_hours: n })
}

// --- percent complete (earned value, manual method only) ----------------
const percentEditable = computed(() => props.task.allowed_actions.includes('write_percent'))
function onPercentSave(value: string) {
  const n = Number(value)
  // A whole number 0..100: anything else is dropped and the saved value stays.
  if (!Number.isInteger(n) || n < 0 || n > 100 || n === props.task.percent_complete) return
  patch({ percent_complete: n })
}

// --- workflow stage ------------------------------------------------------
// Shown only when it says something the status chip does not: a stage named like the state repeats it.
const stageName = computed(() => {
  const name = props.task.stage?.name
  return name && name !== t(STATE_LABEL_KEY[props.task.state]) ? name : null
})

// --- record facts ----------------------------------------------------------
const facts = computed(() => [
  `${t('tasks.drawer.created')} ${createdLabel.value}`,
  `${t('tasks.drawer.updated')} ${updatedLabel.value}`,
  `${t('tasks.drawer.age')} ${t('tasks.drawer.days', { n: props.task.age_days }, props.task.age_days)}`,
  ...(props.task.cycle_days !== null ? [`${t('tasks.drawer.cycle')} ${t('tasks.drawer.days', { n: props.task.cycle_days }, props.task.cycle_days)}`] : []),
].join(' · '))
</script>

<template>
  <div data-testid="task-properties" class="grid min-w-0 gap-4">
    <dl class="divide-y divide-default">
      <SharedPropertyRow :label="t('tasks.drawer.assignees')">
        <span id="task-assignees-label" class="sr-only">{{ t('tasks.drawer.assignees') }}</span>
        <span v-if="!task.can_write">{{ joinList(task.assignees.map(person => person.name), t) || t('tasks.drawer.unassigned') }}</span>
        <AssigneePicker v-else plain :model-value="task.assignees" labelledby="task-assignees-label" @update:model-value="onAssigneesChange" />
      </SharedPropertyRow>
      <SharedPropertyRow :label="t('tasks.drawer.deadline')">
        <span v-if="!task.can_write">{{ deadlineButtonLabel }}</span>
        <SharedDateField
          v-else
          id="task-deadline"
          plain
          :model-value="calendarValue?.toString() ?? null"
          :label="deadlineInstant ? deadlineButtonLabel : t('tasks.deadline.none')"
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
      </SharedPropertyRow>
      <SharedPropertyRow :label="t('tasks.drawer.priority')">
        <span id="task-priority-label" class="sr-only">{{ t('tasks.drawer.priority') }}</span>
        <PrioritySelect :task="task" labelledby="task-priority-label" variant="plain" />
      </SharedPropertyRow>
    </dl>
    <dl class="divide-y divide-default border-t border-default">
      <SharedPropertyRow v-if="task.planning_enabled" :label="t('tasks.drawer.milestone')">
        <span id="task-milestone-label" class="sr-only">{{ t('tasks.drawer.milestone') }}</span>
        <MilestoneSelect v-if="task.project && task.can_write" plain :task="task" labelledby="task-milestone-label" />
        <span v-else>{{ task.milestone?.name || t('tasks.drawer.noMilestone') }}</span>
      </SharedPropertyRow>
      <SharedPropertyRow v-if="stageName" :label="t('tasks.detail.workflowStage')" :value="stageName" />
      <SharedPropertyRow v-if="task.can_write && task.can_approve" :label="t('tasks.drawer.allocatedHours')">
        <SharedInlineText :model-value="String(task.allocated_hours)" :label="t('tasks.drawer.allocatedHours')" type="number" :min="0" :step="0.5" @save="onHoursSave" />
      </SharedPropertyRow>
      <SharedPropertyRow v-if="task.progress_method === 'manual'" :label="t('tasks.drawer.percentComplete')">
        <SharedInlineText
          v-if="percentEditable"
          :model-value="String(task.percent_complete)"
          :label="t('tasks.drawer.percentComplete')"
          type="number"
          :min="0"
          :max="100"
          :step="1"

          data-testid="task-percent-complete"
          input-test-id="task-percent-complete-input"
          @save="onPercentSave"
        ><bdi dir="ltr" class="tabular-nums">{{ task.percent_complete }}%</bdi></SharedInlineText>
        <span v-else dir="ltr" class="tabular-nums" data-testid="task-percent-complete">{{ task.percent_complete }}%</span>
      </SharedPropertyRow>
      <SharedPropertyRow :label="t('tasks.drawer.tags')">
        <span id="task-tags-label" class="sr-only">{{ t('tasks.drawer.tags') }}</span>
        <span v-if="!task.can_write">{{ joinList(task.tags.map(tag => tag.name), t) || '—' }}</span>
        <TagPicker v-else plain :model-value="task.tags" :can-create="task.can_approve" labelledby="task-tags-label" @update:model-value="onTagsChange" />
      </SharedPropertyRow>
    </dl>
    <p data-testid="task-record-facts" class="border-t border-default pt-3 text-xs/5 text-muted">{{ facts }}</p>
  </div>
</template>
