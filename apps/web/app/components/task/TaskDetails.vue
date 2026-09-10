<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { CalendarDate } from '@internationalized/date'
import { ChevronDown } from '@lucide/vue'
import { toCalendarDate } from '@/composables/calendarDate'
import { usePersonalStages } from '@/composables/usePersonalStages'
import { useUpdateTask } from '@/composables/useTasks'
import { useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'
import { validateTaskDates } from '@/utils/projectDateBounds'
import AssigneePicker from './AssigneePicker.vue'
import DependencyPicker from './DependencyPicker.vue'
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
const { mutate: updateTask } = useUpdateTask()
const { data: stages } = usePersonalStages()
const projectId = computed(() => props.task.project?.id ?? null)
// Keep the approved project detail composition for the global task route too.
// This flag is presentation-only; task mutations and project-derived data
// continue to use the original task/project props and composables.
const isProjectTask = computed(() => props.basePath === '/tasks' || props.basePath.startsWith('/projects/'))
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
const dateFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', calendar: 'gregory' }))
const dateTimeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', calendar: 'gregory' }))

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
const completedSubtasks = computed(() => props.task.subtasks.filter(subtask => subtask.is_closed).length)
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <section class="nasq-panel" role="group" :aria-label="t('tasks.detail.primaryMetadata')">
      <header class="nasq-panel-header">
        <h2>{{ t('tasks.detail.primaryMetadata') }}</h2>
      </header>
      <div class="nasq-panel-body task-meta-grid">
        <div class="task-meta-item">
          <span id="task-assignees-label" class="task-meta-label">{{ t('tasks.drawer.assignees') }}</span>
          <p v-if="!task.can_write" class="task-meta-value">{{ task.assignees.map(person => person.name).join('، ') || t('tasks.drawer.unassigned') }}</p>
          <AssigneePicker v-else :model-value="task.assignees" labelledby="task-assignees-label" @update:model-value="onAssigneesChange" />
        </div>

        <div class="task-meta-item">
          <span id="task-priority-label" class="task-meta-label">{{ t('tasks.drawer.priority') }}</span>
          <PrioritySelect :task="task" labelledby="task-priority-label" />
        </div>

        <div class="task-meta-item">
          <span id="task-deadline-label" class="task-meta-label">{{ t('tasks.drawer.deadline') }}</span>
          <p v-if="!task.can_write" class="task-meta-value">{{ deadlineButtonLabel }}</p>
          <Popover v-else>
            <PopoverTrigger as-child>
              <Button variant="outline" size="sm" class="w-full justify-start" type="button" aria-labelledby="task-deadline-label task-deadline-value">
                <span id="task-deadline-value">{{ deadlineButtonLabel }}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar :model-value="calendarValue" :min-value="milestoneStartCalendar" :max-value="milestoneDeadlineCalendar" @update:model-value="onCalendarChange" />
              <div class="flex items-center gap-2 border-t p-2">
                <Label for="deadline-time" class="sr-only">{{ t('tasks.drawer.deadline') }}</Label>
                <Input id="deadline-time" v-model="timeDraft" type="time" class="h-8" @change="onTimeChange" />
                <Button v-if="task.date_deadline" variant="ghost" size="sm" type="button" @click="clearDeadline">
                  {{ t('tasks.deadline.none') }}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <p v-if="deadlineError" role="alert" class="mt-1 text-xs text-destructive">{{ deadlineError }}</p>
        </div>

        <div class="task-meta-item">
          <span id="task-milestone-label" class="task-meta-label">{{ t('tasks.drawer.milestone') }}</span>
          <MilestoneSelect v-if="task.project && task.can_write" :task="task" labelledby="task-milestone-label" />
          <p v-else class="task-meta-value">{{ task.milestone?.name || t('tasks.drawer.noMilestone') }}</p>
        </div>
      </div>
    </section>

    <section class="nasq-panel">
      <header class="nasq-panel-header">
        <h2>{{ t('tasks.drawer.description') }}</h2>
      </header>
      <div class="nasq-panel-body">
        <TaskDescription :key="task.id" :task="task" />
      </div>
    </section>

    <slot name="activity" />

    <component
      :is="isProjectTask ? 'details' : 'div'"
      :class="isProjectTask ? 'nasq-panel task-optional-details' : 'contents'"
    >
      <summary v-if="isProjectTask" class="task-details-summary nasq-panel-header"><span>{{ t('tasks.detail.workResources') }}</span><ChevronDown class="task-disclosure-icon size-4 shrink-0" aria-hidden="true" /></summary>
      <div :class="isProjectTask ? 'nasq-panel-body task-optional-content grid gap-4' : 'contents'">
        <TaskDeliverables :key="`outputs-${task.id}`" :task="task" />

        <section class="nasq-panel">
          <header class="nasq-panel-header">
            <h2>{{ t('tasks.drawer.subtasks') }}</h2>
            <span class="text-xs font-normal text-muted-foreground">{{ t('tasks.detail.subtaskProgress', { done: completedSubtasks, total: task.subtasks.length }) }}</span>
          </header>
          <div class="nasq-panel-body">
            <SubtaskList :task="task" :base-path="props.basePath" />
          </div>
        </section>

        <DependencyPicker :task="task" />

        <TaskAttachments :key="task.id" :task-id="task.id" :can-write="task.can_write" />
      </div>
    </component>

    <details class="nasq-panel">
      <summary class="task-details-summary nasq-panel-header"><span>{{ t('tasks.drawer.additionalDetails') }}</span><ChevronDown v-if="isProjectTask" class="task-disclosure-icon size-4 shrink-0" aria-hidden="true" /></summary>
      <div class="nasq-panel-body">
        <div class="task-additional-grid">
          <section class="task-additional-item">
            <span id="task-stage-label">{{ t('tasks.drawer.stage') }}</span>
            <strong v-if="!task.can_write">{{ task.personal_stage?.name || t('tasks.drawer.unassigned') }}</strong>
            <Select v-else :model-value="task.personal_stage ? String(task.personal_stage.id) : NONE" @update:model-value="onStageChange">
              <SelectTrigger size="sm" class="w-full" aria-labelledby="task-stage-label"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem :value="NONE">{{ t('tasks.drawer.unassigned') }}</SelectItem>
                <SelectItem v-for="s in stages ?? []" :key="s.id" :value="String(s.id)">{{ s.name }}</SelectItem>
              </SelectContent>
            </Select>
          </section>

          <section class="task-additional-item">
            <span id="task-tags-label">{{ t('tasks.drawer.tags') }}</span>
            <strong v-if="!task.can_write">{{ task.tags.map(tag => tag.name).join('، ') || '—' }}</strong>
            <TagPicker v-else :model-value="task.tags" :can-create="task.can_approve" labelledby="task-tags-label" @update:model-value="onTagsChange" />
          </section>

          <section v-if="task.can_write && task.can_approve" class="task-additional-item">
            <Label for="allocated-hours" class="text-muted-foreground">{{ t('tasks.drawer.allocatedHours') }}</Label>
            <Input id="allocated-hours" v-model="hoursDraft" type="number" min="0" step="0.5" class="mt-2" @change="onHoursChange" />
          </section>

          <section class="task-additional-item">
            <span>{{ t('tasks.drawer.created') }}</span>
            <strong>{{ createdLabel }}</strong>
          </section>
          <section class="task-additional-item">
            <span>{{ t('tasks.drawer.updated') }}</span>
            <strong>{{ updatedLabel }}</strong>
          </section>
          <section class="task-additional-item">
            <span>{{ t('tasks.drawer.age') }}</span>
            <strong>{{ t('tasks.drawer.days', { n: task.age_days }) }}</strong>
          </section>
          <section v-if="task.cycle_days !== null" class="task-additional-item">
            <span>{{ t('tasks.drawer.cycle') }}</span>
            <strong>{{ t('tasks.drawer.days', { n: task.cycle_days }) }}</strong>
          </section>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.task-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 16px;
}

.task-meta-item {
  min-width: 0;
}

.task-meta-label,
.task-additional-item > span {
  display: block;
  margin-bottom: 6px;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.task-meta-value,
.task-additional-item > strong {
  display: block;
  overflow-wrap: anywhere;
  color: var(--foreground);
  font-size: 0.875rem;
  font-weight: 600;
}

.task-details-summary {
  cursor: pointer;
  list-style-position: inside;
}

.task-details-summary::marker {
  color: var(--muted-foreground);
}

details[open] > summary .task-disclosure-icon {
  transform: rotate(180deg);
}

.task-additional-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px 12px;
}

.task-additional-item {
  min-width: 0;
}

@media (max-width: 1000px) {
  .task-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .task-additional-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 320px) {
  .task-meta-grid,
  .task-additional-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
