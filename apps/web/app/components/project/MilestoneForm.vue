<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import type { Milestone } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, fromCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useCreateMilestone, useUpdateMilestone } from '@/composables/useMilestones'
import { isDirtySnapshot } from '@/lib/formDirty'
import { validateMilestoneDates } from '@/utils/projectDateBounds'
import { buildMilestonePatch } from '@/utils/milestonePayload'

const props = defineProps<{
  projectId: number
  milestone?: Milestone
  projectStart?: string | null
  projectEnd?: string | null
}>()
const emit = defineEmits<{ saved: [id?: number]; cancel: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createMutate, isPending: creating } = useCreateMilestone()
const { mutateAsync: updateMutate, isPending: updating } = useUpdateMilestone()
const isEdit = computed(() => !!props.milestone)
const isPending = computed(() => creating.value || updating.value)
const name = ref(props.milestone?.name ?? '')
const startDate = shallowRef<CalendarDate | undefined>(toCalendarDate(props.milestone?.start_date ?? null))
const deadline = shallowRef<CalendarDate | undefined>(toCalendarDate(props.milestone?.deadline ?? null))
const deliverables = ref<Array<{ name: string; done: boolean }>>([])
const error = ref<string | null>(null)
const projectScheduleMissing = ref(false)
const submitted = ref(false)
const baseline = ref('')

function state() {
  return JSON.stringify([name.value, fromCalendarDate(startDate.value), fromCalendarDate(deadline.value), deliverables.value])
}

const dirty = computed(() => isDirtySnapshot(baseline.value, state(), submitted.value))

watch(() => props.milestone, (milestone) => {
  name.value = milestone?.name ?? ''
  startDate.value = toCalendarDate(milestone?.start_date ?? null)
  deadline.value = toCalendarDate(milestone?.deadline ?? null)
  deliverables.value = (milestone?.deliverables ?? []).map(item => ({ name: item.name, done: item.done }))
  submitted.value = false
  baseline.value = state()
}, { immediate: true })

const deadlineLabel = computed(() => deadline.value ? formatCalendarDate(fromCalendarDate(deadline.value), locale.value) : t('projects.milestones.deadline'))
const startDateLabel = computed(() => startDate.value ? formatCalendarDate(fromCalendarDate(startDate.value), locale.value) : t('projects.milestones.startDate'))
const projectStartCalendar = computed(() => toCalendarDate(props.projectStart ?? null))
const projectEndCalendar = computed(() => toCalendarDate(props.projectEnd ?? null))
function onCalendarChange(v: unknown) { deadline.value = v as CalendarDate }
function onStartChange(v: unknown) { startDate.value = v as CalendarDate }
function clearDeadline() { deadline.value = undefined }
function clearStartDate() { startDate.value = undefined }
function addDeliverable() { deliverables.value.push({ name: '', done: false }) }
function removeDeliverable(index: number) { deliverables.value.splice(index, 1) }

const dateError = computed(() => validateMilestoneDates({
  projectStart: props.projectStart,
  projectEnd: props.projectEnd,
  startDate: fromCalendarDate(startDate.value),
  deadline: fromCalendarDate(deadline.value),
}))

async function submit() {
  error.value = null
  projectScheduleMissing.value = false
  const trimmed = name.value.trim()
  if (!hydrated.value || isPending.value || !trimmed) return
  if (!props.milestone && (!props.projectStart || !props.projectEnd || !startDate.value || !deadline.value)) {
    error.value = t('projects.milestones.scheduleRequired')
    projectScheduleMissing.value = !props.projectStart || !props.projectEnd
    return
  }
  const nextStartDate = fromCalendarDate(startDate.value)
  const nextDeadline = fromCalendarDate(deadline.value)
  const datesChanged = !props.milestone || nextStartDate !== (props.milestone.start_date ?? null) || nextDeadline !== (props.milestone.deadline ?? null)
  if (datesChanged && dateError.value) {
    error.value = t(`projects.milestones.${dateError.value.split('.').pop()}`)
    return
  }
  const output = deliverables.value.map(item => ({ name: item.name.trim(), done: item.done })).filter(item => item.name)
  try {
    if (props.milestone) {
      await updateMutate({ projectId: props.projectId, id: props.milestone.id, patch: buildMilestonePatch({ name: trimmed, startDate: nextStartDate, deadline: nextDeadline, deliverables: output, originalStartDate: props.milestone.start_date, originalDeadline: props.milestone.deadline, isNew: false }) })
      submitted.value = true
      emit('saved', props.milestone.id)
    } else {
      const created = await createMutate({ projectId: props.projectId, name: trimmed, start_date: fromCalendarDate(startDate.value), deadline: fromCalendarDate(deadline.value), deliverables: output })
      submitted.value = true
      emit('saved', created.id)
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form data-testid="milestone-form" class="nasq-form-grid" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="milestone-name">{{ t('projects.milestones.name') }}</Label>
      <Input id="milestone-name" v-model="name" required :disabled="!hydrated || isPending" />
    </div>
    <div class="grid gap-2">
      <Label>{{ t('projects.milestones.startDate') }}</Label>
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="outline" type="button" class="w-full justify-start" :disabled="!hydrated || isPending" :aria-label="t('projects.milestones.startDate')">{{ startDateLabel }}</Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
          <Calendar :model-value="startDate" :min-value="projectStartCalendar" :max-value="projectEndCalendar" @update:model-value="onStartChange" />
          <div v-if="startDate" class="border-t p-2"><Button variant="ghost" size="sm" type="button" class="w-full" @click="clearStartDate">{{ t('tasks.deadline.none') }}</Button></div>
        </PopoverContent>
      </Popover>
    </div>
    <div class="grid gap-2">
      <Label>{{ t('projects.milestones.deadline') }}</Label>
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="outline" type="button" class="w-full justify-start" :disabled="!hydrated || isPending" :aria-label="t('projects.milestones.deadline')">{{ deadlineLabel }}</Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
          <Calendar :model-value="deadline" :min-value="projectStartCalendar" :max-value="projectEndCalendar" @update:model-value="onCalendarChange" />
          <div v-if="deadline" class="border-t p-2">
            <Button variant="ghost" size="sm" type="button" class="w-full" @click="clearDeadline">{{ t('tasks.deadline.none') }}</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
    <div class="grid gap-2 sm:col-span-2">
      <div class="flex items-center justify-between gap-3">
        <div><Label>{{ t('projects.milestones.deliverables') }}</Label><p class="text-xs text-muted-foreground">{{ t('projects.milestones.deliverablesHint') }}</p></div>
        <Button type="button" variant="outline" size="sm" :disabled="!hydrated || isPending" @click="addDeliverable">{{ t('projects.milestones.addDeliverable') }}</Button>
      </div>
      <div v-if="deliverables.length" class="space-y-2">
        <div v-for="(item, index) in deliverables" :key="index" class="flex items-center gap-2">
          <input v-model="item.done" type="checkbox" :aria-label="t('projects.milestones.deliverableDone')" :disabled="!hydrated || isPending" class="size-4 rounded border-border accent-primary" />
          <Input v-model="item.name" :aria-label="t('projects.milestones.deliverableName')" :disabled="!hydrated || isPending" />
          <Button type="button" variant="ghost" size="sm" :disabled="!hydrated || isPending" :aria-label="t('projects.milestones.removeDeliverable')" @click="removeDeliverable(index)">×</Button>
        </div>
      </div>
      <p v-else class="text-sm text-muted-foreground">{{ t('projects.milestones.noDeliverables') }}</p>
    </div>
    <div v-if="error" role="alert" class="text-sm text-destructive sm:col-span-2">
      <p>{{ error }}</p>
      <NuxtLink v-if="projectScheduleMissing" class="mt-1 inline-block underline underline-offset-4" :to="{ path: `/projects/${props.projectId}/charter`, query: { edit: '1' } }">{{ t('projects.milestones.openProjectFile') }}</NuxtLink>
    </div>
    <div class="nasq-form-footer sm:col-span-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ isEdit ? t('app.save') : t('app.create') }}</Button>
    </div>
  </form>
</template>
