<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { TaskDetail } from '@webvue/contracts'
import { CalendarDate, parseDate } from '@internationalized/date'
import { formatWebVueDate } from '@webvue/ui/app/composables/calendarDate'
import { usePersonalStages } from '@/composables/usePersonalStages'
import { useUpdateTask } from '@/composables/useTasks'
import { useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'
import { validateTaskDates } from '@/utils/projectDateBounds'
import AssigneePicker from './AssigneePicker.vue'
import MilestoneSelect from './MilestoneSelect.vue'
import PrioritySelect from './PrioritySelect.vue'
import TagPicker from '@/components/shared/form/TagPicker.vue'
const props = defineProps<{ task: TaskDetail }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
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

function patch(body: Parameters<typeof updateTask>[0]['patch'], resolved?: Parameters<typeof updateTask>[0]['resolved']) {
  if (props.task.can_write) updateTask({ id: props.task.id, patch: body, resolved })
}

// --- title -------------------------------------------------------------
// The title is edited here, like every other property: commit on Enter or when the field loses
// focus, Escape puts the saved name back. There is no separate edit mode on the heading.
const nameDraft = ref(props.task.name)
watch(() => props.task.name, (name) => { nameDraft.value = name })
function saveName() {
  if (!props.task.can_write) return
  const name = nameDraft.value.trim()
  if (!name || name === props.task.name) {
    nameDraft.value = props.task.name
    return
  }
  updateTask({ id: props.task.id, patch: { name } }, {
    onError: () => { nameDraft.value = props.task.name },
  })
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
const dateFmt = computed(() => ({ format: (value: Date) => formatWebVueDate(value, locale.value) }))

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

</script>

<template>
  <SharedPropertiesPanel data-testid="task-properties" :title="t('tasks.detail.primaryMetadata')">
    <SharedPropertyRow v-if="task.can_write" :label="t('tasks.newTitle')">
      <UInput
        v-model="nameDraft"
        data-testid="task-title-input"
        size="sm"
        class="w-full"
        :disabled="!hydrated"
        :aria-label="t('tasks.newTitle')"
        @blur="saveName"
        @keydown.enter.prevent="saveName"
        @keydown.escape.stop.prevent="nameDraft = task.name"
      />
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('tasks.drawer.assignees')">
      <span id="task-assignees-label" class="sr-only">{{ t('tasks.drawer.assignees') }}</span>
      <span v-if="!task.can_write">{{ joinList(task.assignees.map(person => person.name), t) || t('tasks.drawer.unassigned') }}</span>
      <AssigneePicker v-else :model-value="task.assignees" labelledby="task-assignees-label" @update:model-value="onAssigneesChange" />
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('tasks.drawer.priority')">
      <span id="task-priority-label" class="sr-only">{{ t('tasks.drawer.priority') }}</span>
      <PrioritySelect :task="task" labelledby="task-priority-label" variant="outline" />
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('tasks.drawer.deadline')">
      <span v-if="!task.can_write">{{ deadlineButtonLabel }}</span>
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
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('tasks.drawer.milestone')">
      <span id="task-milestone-label" class="sr-only">{{ t('tasks.drawer.milestone') }}</span>
      <MilestoneSelect v-if="task.project && task.can_write" :task="task" labelledby="task-milestone-label" />
      <span v-else>{{ task.milestone?.name || t('tasks.drawer.noMilestone') }}</span>
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('tasks.drawer.stage')">
      <span v-if="!task.can_write">{{ task.personal_stage?.name || t('tasks.drawer.unassigned') }}</span>
      <USelect
        v-else
        :disabled="!hydrated"
        size="sm"
        class="w-full"
        :aria-label="t('tasks.drawer.stage')"
        :items="[{ label: t('tasks.drawer.unassigned'), value: NONE }, ...(stages ?? []).map((s) => ({ label: s.name, value: String(s.id) }))]"
        :model-value="task.personal_stage ? String(task.personal_stage.id) : NONE"
        @update:model-value="onStageChange"
      />
    </SharedPropertyRow>
    <SharedPropertyRow v-if="task.can_write && task.can_approve" :label="t('tasks.drawer.allocatedHours')">
      <UInput id="allocated-hours" :disabled="!hydrated" v-model="hoursDraft" type="number" min="0" step="0.5" size="sm" class="w-full" :aria-label="t('tasks.drawer.allocatedHours')" @change="onHoursChange" />
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('tasks.drawer.tags')">
      <span id="task-tags-label" class="sr-only">{{ t('tasks.drawer.tags') }}</span>
      <span v-if="!task.can_write">{{ joinList(task.tags.map(tag => tag.name), t) || '—' }}</span>
      <TagPicker v-else :model-value="task.tags" :can-create="task.can_approve" labelledby="task-tags-label" @update:model-value="onTagsChange" />
    </SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
