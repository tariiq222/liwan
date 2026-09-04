<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { CalendarDate } from '@internationalized/date'
import { usePersonalStages } from '@/composables/usePersonalStages'
import { useUpdateTask } from '@/composables/useTasks'
import AssigneePicker from './AssigneePicker.vue'
import DescriptionEditor from './DescriptionEditor.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateBadge from './StateBadge.vue'
import SubtaskList from './SubtaskList.vue'

const props = defineProps<{ task: TaskDetail }>()

const { t, locale } = useI18n()
const { mutate: updateTask } = useUpdateTask()
const { data: stages } = usePersonalStages()

function patch(body: Parameters<typeof updateTask>[0]['patch'], resolved?: Parameters<typeof updateTask>[0]['resolved']) {
  updateTask({ id: props.task.id, patch: body, resolved })
}

// --- assignees -------------------------------------------------------
function onAssigneesChange({ ids, resolved }: { ids: number[]; resolved: TaskDetail['assignees'] }) {
  patch({ user_ids: ids }, { assignees: resolved })
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

// --- description ---------------------------------------------------------
// Addressed to the task id the editor captured *at typing time*, not the
// live `props.task.id` — with a prev/next navigation this closure can still
// be running (a flush fired during unmount) after `task` has already moved
// on to another id, so a live read would misdirect the PATCH.
function onDescriptionChange({ html, taskId }: { html: string; taskId: number }) {
  updateTask({ id: taskId, patch: { description: html } })
}

// --- metrics ---------------------------------------------------------------
const createdLabel = computed(() => dateTimeFmt.value.format(new Date(props.task.created_at)))
const updatedLabel = computed(() => dateTimeFmt.value.format(new Date(props.task.updated_at)))
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-2">
      <Label>{{ t('tasks.drawer.assignees') }}</Label>
      <AssigneePicker :model-value="task.assignees" @update:model-value="onAssigneesChange" />
    </section>

    <section class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label>{{ t('tasks.drawer.deadline') }}</Label>
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" class="w-full justify-start" type="button" :aria-label="t('tasks.drawer.deadline')">
              {{ deadlineButtonLabel }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar :model-value="calendarValue" @update:model-value="onCalendarChange" />
            <div class="flex items-center gap-2 border-t p-2">
              <Label for="deadline-time" class="sr-only">{{ t('tasks.drawer.deadline') }}</Label>
              <Input id="deadline-time" v-model="timeDraft" type="time" class="h-8" @change="onTimeChange" />
              <Button v-if="task.date_deadline" variant="ghost" size="sm" type="button" @click="clearDeadline">
                {{ t('tasks.deadline.none') }}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div class="space-y-2">
        <Label>{{ t('tasks.drawer.priority') }}</Label>
        <PrioritySelect :task="task" />
      </div>
    </section>

    <section class="space-y-2">
      <Label>{{ t('tasks.drawer.tags') }}</Label>
      <div class="flex flex-wrap gap-1">
        <Badge v-for="tag in task.tags" :key="tag.id" variant="outline">{{ tag.name }}</Badge>
        <span v-if="task.tags.length === 0" class="text-sm text-muted-foreground">—</span>
      </div>
    </section>

    <section class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label>{{ t('tasks.drawer.stage') }}</Label>
        <Select :model-value="task.personal_stage ? String(task.personal_stage.id) : NONE" @update:model-value="onStageChange">
          <SelectTrigger size="sm" class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="NONE">{{ t('tasks.drawer.unassigned') }}</SelectItem>
            <SelectItem v-for="s in stages ?? []" :key="s.id" :value="String(s.id)">{{ s.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div v-if="task.can_approve" class="space-y-2">
        <Label for="allocated-hours">{{ t('tasks.drawer.allocatedHours') }}</Label>
        <Input id="allocated-hours" v-model="hoursDraft" type="number" min="0" step="0.5" @change="onHoursChange" />
      </div>
    </section>

    <Separator />

    <section class="space-y-2">
      <Label>{{ t('tasks.drawer.description') }}</Label>
      <DescriptionEditor :model-value="task.description_html" :task-id="task.id" @update:model-value="onDescriptionChange" />
    </section>

    <Separator />

    <section class="space-y-2">
      <Label>{{ t('tasks.drawer.subtasks') }}</Label>
      <SubtaskList :task="task" />
    </section>

    <section v-if="task.depends_on.length" class="space-y-2">
      <Label>{{ t('tasks.drawer.dependsOn') }}</Label>
      <ul class="space-y-1">
        <li v-for="dep in task.depends_on" :key="dep.id" class="flex items-center gap-2 text-sm">
          <StateBadge :state="dep.state" />
          <span class="truncate">{{ dep.name }}</span>
        </li>
      </ul>
    </section>

    <section v-if="task.attachments.length" class="space-y-2">
      <Label>{{ t('tasks.drawer.attachments') }}</Label>
      <ul class="space-y-1">
        <li v-for="att in task.attachments" :key="att.id" class="text-sm">
          <a :href="att.url" target="_blank" rel="noopener" class="text-primary underline">{{ att.name }}</a>
        </li>
      </ul>
    </section>

    <Separator />

    <section class="space-y-1 text-sm text-muted-foreground">
      <Label class="text-foreground">{{ t('tasks.drawer.metrics') }}</Label>
      <div>{{ t('tasks.drawer.age') }}: {{ t('tasks.drawer.days', { n: task.age_days }) }}</div>
      <div v-if="task.cycle_days !== null">{{ t('tasks.drawer.cycle') }}: {{ t('tasks.drawer.days', { n: task.cycle_days }) }}</div>
      <div>{{ t('tasks.drawer.created') }}: {{ createdLabel }}</div>
      <div>{{ t('tasks.drawer.updated') }}: {{ updatedLabel }}</div>
    </section>
  </div>
</template>
