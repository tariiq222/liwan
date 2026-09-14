<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { CalendarDate } from '@internationalized/date'
import { formatNasqDate, formatNasqDateTime, toCalendarDate } from '@/composables/calendarDate'
import { usePersonalStages } from '@/composables/usePersonalStages'
import { useUpdateTask } from '@/composables/useTasks'
import { useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'
import { validateTaskDates } from '@/utils/projectDateBounds'
import AssigneePicker from './AssigneePicker.vue'
import MilestoneSelect from './MilestoneSelect.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'
import TagPicker from './TagPicker.vue'

// The record's properties column (Stripe-style aside): one label/value pair
// per field, each value being the same inline control the task already used.
// Owns the deadline/stage/hours/tags/assignees writes; TaskDetails keeps the
// long-form sections (description, activity, resources).
const props = defineProps<{ task: TaskDetail }>()

const { t, locale } = useI18n()
const { mutate: updateTask } = useUpdateTask()
const { data: stages } = usePersonalStages()
const projectId = computed(() => props.task.project?.id ?? null)
const { data: milestones } = useMilestones(projectId)
const { data: project } = useProject(projectId)
const deadlineError = ref<string | null>(null)
const selectedMilestone = computed(() => {
  const milestoneId = props.task.milestone?.id
  return milestones.value?.find(item => item.id === milestoneId)
})
const milestoneStart = computed(() => selectedMilestone.value?.start_date ?? project.value?.date_start ?? null)
const milestoneDeadline = computed(() => selectedMilestone.value?.deadline ?? project.value?.date_end ?? null)
const milestoneStartCalendar = computed(() => toCalendarDate(milestoneStart.value))
const milestoneDeadlineCalendar = computed(() => toCalendarDate(milestoneDeadline.value))

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
// converts the viewer's local wall clock back to an instant.
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

function onCalendarChange(v: unknown) {
  setDeadline(v as CalendarDate, timeDraft.value)
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
</script>

<template>
  <dl class="nasq-record-props" data-testid="task-properties" :aria-label="t('tasks.detail.primaryMetadata')">
    <div class="nasq-record-prop">
      <dt id="task-state-label" class="nasq-ui-label">{{ t('tasks.columns.state') }}</dt>
      <dd><StateMenu :task="task" :can-approve="task.can_approve" /></dd>
    </div>

    <div class="nasq-record-prop">
      <dt id="task-assignees-label" class="nasq-ui-label">{{ t('tasks.drawer.assignees') }}</dt>
      <dd>
        <span v-if="!task.can_write">{{ task.assignees.map(person => person.name).join('، ') || t('tasks.drawer.unassigned') }}</span>
        <AssigneePicker v-else :model-value="task.assignees" labelledby="task-assignees-label" @update:model-value="onAssigneesChange" />
      </dd>
    </div>

    <div class="nasq-record-prop">
      <dt id="task-deadline-label" class="nasq-ui-label">{{ t('tasks.drawer.deadline') }}</dt>
      <dd>
        <span v-if="!task.can_write" class="nasq-ui-num">{{ deadlineButtonLabel }}</span>
        <UPopover v-else :content="{ align: 'start' }">
          <UButton variant="outline" color="neutral" size="sm" class="nasq-ui-num w-full justify-start font-normal" type="button" aria-labelledby="task-deadline-label task-deadline-value">
            <span id="task-deadline-value">{{ deadlineButtonLabel }}</span>
          </UButton>
          <template #content>
            <UCalendar :model-value="calendarValue" :min-value="milestoneStartCalendar" :max-value="milestoneDeadlineCalendar" @update:model-value="onCalendarChange" />
            <div class="flex items-center gap-2 border-t p-2">
              <label for="deadline-time" class="sr-only">{{ t('tasks.drawer.deadline') }}</label>
              <UInput id="deadline-time" v-model="timeDraft" type="time" class="h-8" @change="onTimeChange" />
              <UButton v-if="task.date_deadline" variant="ghost" size="sm" type="button" @click="clearDeadline">
                {{ t('tasks.deadline.none') }}
              </UButton>
            </div>
          </template>
        </UPopover>
        <p v-if="deadlineError" role="alert" class="mt-1 text-xs text-error">{{ deadlineError }}</p>
      </dd>
    </div>

    <div class="nasq-record-prop">
      <dt id="task-priority-label" class="nasq-ui-label">{{ t('tasks.drawer.priority') }}</dt>
      <dd><PrioritySelect :task="task" labelledby="task-priority-label" /></dd>
    </div>

    <div class="nasq-record-prop">
      <dt id="task-milestone-label" class="nasq-ui-label">{{ t('tasks.drawer.milestone') }}</dt>
      <dd>
        <MilestoneSelect v-if="task.project && task.can_write" :task="task" labelledby="task-milestone-label" />
        <span v-else>{{ task.milestone?.name || t('tasks.drawer.noMilestone') }}</span>
      </dd>
    </div>

    <div class="nasq-record-prop">
      <dt id="task-stage-label" class="nasq-ui-label">{{ t('tasks.drawer.stage') }}</dt>
      <dd>
        <span v-if="!task.can_write">{{ task.personal_stage?.name || t('tasks.drawer.unassigned') }}</span>
        <USelect
          v-else
          size="sm"
          class="w-full"
          aria-labelledby="task-stage-label"
          :items="[{ label: t('tasks.drawer.unassigned'), value: NONE }, ...(stages ?? []).map((s) => ({ label: s.name, value: String(s.id) }))]"
          :model-value="task.personal_stage ? String(task.personal_stage.id) : NONE"
          @update:model-value="onStageChange"
        />
      </dd>
    </div>

    <div class="nasq-record-prop">
      <dt id="task-tags-label" class="nasq-ui-label">{{ t('tasks.drawer.tags') }}</dt>
      <dd>
        <span v-if="!task.can_write">{{ task.tags.map(tag => tag.name).join('، ') || '—' }}</span>
        <TagPicker v-else :model-value="task.tags" :can-create="task.can_approve" labelledby="task-tags-label" @update:model-value="onTagsChange" />
      </dd>
    </div>

    <div v-if="task.can_write && task.can_approve" class="nasq-record-prop">
      <dt class="nasq-ui-label"><label for="allocated-hours">{{ t('tasks.drawer.allocatedHours') }}</label></dt>
      <dd><UInput id="allocated-hours" v-model="hoursDraft" type="number" min="0" step="0.5" size="sm" class="w-full" @change="onHoursChange" /></dd>
    </div>

    <div class="nasq-record-prop nasq-record-prop-meta">
      <dt class="nasq-ui-label">{{ t('tasks.drawer.created') }}</dt>
      <dd class="nasq-ui-num text-muted">{{ createdLabel }}</dd>
    </div>
    <div class="nasq-record-prop nasq-record-prop-meta">
      <dt class="nasq-ui-label">{{ t('tasks.drawer.updated') }}</dt>
      <dd class="nasq-ui-num text-muted">{{ updatedLabel }}</dd>
    </div>
    <div class="nasq-record-prop nasq-record-prop-meta">
      <dt class="nasq-ui-label">{{ t('tasks.drawer.age') }}</dt>
      <dd class="nasq-ui-num text-muted">{{ t('tasks.drawer.days', { n: task.age_days }) }}</dd>
    </div>
    <div v-if="task.cycle_days !== null" class="nasq-record-prop nasq-record-prop-meta">
      <dt class="nasq-ui-label">{{ t('tasks.drawer.cycle') }}</dt>
      <dd class="nasq-ui-num text-muted">{{ t('tasks.drawer.days', { n: task.cycle_days }) }}</dd>
    </div>
  </dl>
</template>
