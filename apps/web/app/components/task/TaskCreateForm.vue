<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject, useProjects } from '@/composables/useProjects'
import { useMilestones } from '@/composables/useMilestones'
import { useCreateTask } from '@/composables/useTasks'
import { isDirtySnapshot } from '@/lib/formDirty'
import { validateTaskDates } from '@/utils/projectDateBounds'
import { buildTaskCreatePayload, plainTextToTaskHtml, validateTaskCreatePolicy, type TaskDeliverable } from '@/utils/taskCreatePolicy'

const props = defineProps<{
  mode?: 'default' | 'project'
  projectId?: number
  milestoneId?: number | null
  projectStart?: string | null
  projectEnd?: string | null
  canManage?: boolean
}>()
const emit = defineEmits<{ created: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { data: projects } = useProjects()
const { mutateAsync, isPending } = useCreateTask()

const name = ref('')
const description = ref('')
const deliverables = ref<TaskDeliverable[]>([])
const projectSelectionTouched = ref(false)
const selectedProjectId = ref<number | undefined>(props.projectId)
const selectedMilestoneId = ref<number | undefined>(props.milestoneId ?? undefined)
const plannedStart = ref('')
const dateDeadline = ref('')
const error = ref<string | null>(null)
const submitted = ref(false)
const baseline = ref(JSON.stringify(['', '', [], props.projectId, props.milestoneId ?? undefined, '', '']))

const milestoneProjectId = computed(() => selectedProjectId.value ?? null)
const { data: milestones, isLoading: milestonesLoading, error: milestonesError } = useMilestones(milestoneProjectId)
const { data: selectedProject, isLoading: projectLoading, error: projectError } = useProject(milestoneProjectId)
const milestoneOptions = computed(() => milestones.value ?? [])
const selectedMilestone = computed(() => milestoneOptions.value.find(item => item.id === selectedMilestoneId.value))
const projectStart = computed(() => props.projectStart ?? selectedProject.value?.date_start ?? null)
const projectEnd = computed(() => props.projectEnd ?? selectedProject.value?.date_end ?? null)
const guided = computed(() => props.projectId !== undefined)
const canManageDates = computed(() => props.canManage ?? selectedProject.value?.can_manage === true)
const hasDatedMilestones = computed(() => milestoneOptions.value.some(item => !!item.start_date && !!item.deadline))
const policyError = computed(() => validateTaskCreatePolicy({
  guided: guided.value,
  canManage: canManageDates.value,
  projectReady: !!selectedProject.value && !projectError.value,
  projectLoading: projectLoading.value,
  milestonesLoading: milestonesLoading.value,
  milestonesFailed: !!milestonesError.value,
  hasDatedMilestones: hasDatedMilestones.value,
  selectedMilestone: !!selectedMilestone.value,
  plannedStart: plannedStart.value || null,
  dateDeadline: dateDeadline.value ? `${dateDeadline.value}T23:59:00Z` : null,
}))
const projectQuick = computed(() => props.mode === 'project')

function state() {
  return JSON.stringify([name.value, description.value, deliverables.value, selectedProjectId.value, selectedMilestoneId.value, plannedStart.value, dateDeadline.value])
}

const hasDraftValues = computed(() => Boolean(
  name.value.trim()
  || description.value.trim()
  || deliverables.value.length
  || selectedMilestoneId.value !== undefined
  || plannedStart.value
  || dateDeadline.value
  || projectSelectionTouched.value,
))

const dirty = computed(() => isDirtySnapshot(baseline.value, state(), submitted.value))

watch(
  () => [props.projectId, projects.value] as const,
  () => {
    if (props.projectId) selectedProjectId.value = props.projectId
    else if (!selectedProjectId.value) selectedProjectId.value = projects.value?.[0]?.id
    // A project refetch can retrigger this watcher while a user is still
    // drafting content. Keep that draft dirty until it is submitted.
    if (!hasDraftValues.value && !submitted.value) baseline.value = state()
  },
  { immediate: true },
)

watch([() => props.milestoneId, milestoneOptions, selectedProjectId], () => {
  if (props.milestoneId && props.projectId && selectedProjectId.value === props.projectId) selectedMilestoneId.value = props.milestoneId
  if (selectedMilestoneId.value && !selectedMilestone.value) selectedMilestoneId.value = undefined
})

const lockedProjectName = computed(() => projects.value?.find((p) => p.id === props.projectId)?.name ?? '')
const dateError = computed(() => validateTaskDates({
  milestoneStart: selectedMilestone.value?.start_date ?? projectStart.value,
  milestoneDeadline: selectedMilestone.value?.deadline ?? projectEnd.value,
  plannedStart: plannedStart.value || null,
  dateDeadline: dateDeadline.value ? `${dateDeadline.value}T23:59:00Z` : null,
}))

function dateErrorText(key: string): string {
  return t(`tasks.schedule.${key.split('.').pop()}`)
}

function addDeliverable() {
  deliverables.value.push({ name: '', done: false })
}

function removeDeliverable(index: number) {
  deliverables.value.splice(index, 1)
}

function selectProject(value: unknown) {
  projectSelectionTouched.value = true
  selectedProjectId.value = value ? Number(value) : undefined
}

async function submit() {
  error.value = null
  const trimmed = name.value.trim()
  if (!hydrated.value || isPending.value || !trimmed || !selectedProjectId.value) return
  if (policyError.value) {
    error.value = t(policyError.value)
    return
  }
  if (dateError.value) {
    error.value = dateErrorText(dateError.value)
    return
  }
  try {
    const descriptionText = description.value.trim()
    const created = await mutateAsync(buildTaskCreatePayload({
      name: trimmed,
      projectId: selectedProjectId.value,
      milestoneId: selectedMilestoneId.value,
      plannedStart: plannedStart.value || undefined,
      dateDeadline: dateDeadline.value ? `${dateDeadline.value}T23:59:00Z` : undefined,
      description: descriptionText ? plainTextToTaskHtml(descriptionText) : undefined,
      deliverables: deliverables.value,
    }))
    submitted.value = true
    emit('created', created.id)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form data-testid="task-create-form" class="nasq-form-grid" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="new-task-name">{{ t('tasks.newTitle') }}</Label>
      <Input id="new-task-name" v-model="name" required :disabled="!hydrated || isPending" />
    </div>
    <div v-if="selectedProjectId && canManageDates" class="grid gap-2">
      <Label for="new-task-milestone">{{ t('tasks.drawer.milestone') }}</Label>
      <Select :model-value="selectedMilestoneId ? String(selectedMilestoneId) : 'none'" :disabled="!hydrated || isPending" @update:model-value="(v) => (selectedMilestoneId = v && v !== 'none' ? Number(v) : undefined)">
        <SelectTrigger id="new-task-milestone" class="w-full"><SelectValue :placeholder="t('tasks.drawer.noMilestone')" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{ t('tasks.drawer.noMilestone') }}</SelectItem>
          <SelectItem v-for="milestone in milestoneOptions" :key="milestone.id" :value="String(milestone.id)">{{ milestone.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div v-if="canManageDates" class="grid gap-2">
      <Label for="new-task-planned-start">{{ t('tasks.schedule.plannedStart') }}</Label>
      <Input id="new-task-planned-start" v-model="plannedStart" type="date" :disabled="!hydrated || isPending" :min="selectedMilestone?.start_date ?? projectStart ?? undefined" :max="selectedMilestone?.deadline ?? projectEnd ?? undefined" />
    </div>
    <div v-if="canManageDates" class="grid gap-2">
      <Label for="new-task-deadline">{{ t('tasks.drawer.deadline') }}</Label>
      <Input id="new-task-deadline" v-model="dateDeadline" type="date" :disabled="!hydrated || isPending" :min="selectedMilestone?.start_date ?? projectStart ?? undefined" :max="selectedMilestone?.deadline ?? projectEnd ?? undefined" />
    </div>
    <div class="grid gap-2">
      <Label for="new-task-project">{{ t('tasks.project') }}</Label>
      <p v-if="props.projectId" id="new-task-project" class="text-sm">{{ lockedProjectName }}</p>
      <Select v-else :model-value="selectedProjectId ? String(selectedProjectId) : undefined" :disabled="!hydrated || isPending" @update:model-value="selectProject">
        <SelectTrigger id="new-task-project" class="w-full">
          <SelectValue :placeholder="t('tasks.project')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="p in projects ?? []" :key="p.id" :value="String(p.id)">{{ p.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <component
      :is="projectQuick ? 'details' : 'div'"
      :data-testid="projectQuick ? 'task-create-optional' : undefined"
      :class="projectQuick ? 'sm:col-span-2 rounded-lg border p-4' : 'contents'"
    >
      <summary v-if="projectQuick" class="cursor-pointer font-semibold">{{ t('tasks.quick.optional') }}</summary>
      <div :class="projectQuick ? 'mt-4 grid gap-6' : 'contents'">
        <div class="grid gap-2 sm:col-span-2">
          <Label for="new-task-description">{{ t('tasks.drawer.description') }}</Label>
          <textarea id="new-task-description" v-model="description" class="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" :placeholder="t('tasks.descriptionField.placeholder')" :disabled="!hydrated || isPending" />
        </div>
        <div class="grid gap-2 sm:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>{{ t('tasks.deliverables.title') }}</Label>
              <p class="text-xs text-muted-foreground">{{ t('tasks.deliverables.hint') }}</p>
            </div>
            <Button type="button" variant="outline" size="sm" :disabled="!hydrated || isPending" @click="addDeliverable">{{ t('tasks.deliverables.add') }}</Button>
          </div>
          <div v-if="deliverables.length" class="space-y-2">
            <div v-for="(item, index) in deliverables" :key="index" class="flex items-center gap-2">
              <Input v-model="item.name" :aria-label="t('tasks.deliverables.name')" :disabled="!hydrated || isPending" />
              <Button type="button" variant="ghost" size="sm" :disabled="!hydrated || isPending" :aria-label="t('tasks.deliverables.remove')" @click="removeDeliverable(index)">×</Button>
            </div>
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('tasks.deliverables.empty') }}</p>
        </div>
      </div>
    </component>
    <p v-if="error" role="alert" class="sm:col-span-2 text-sm text-destructive">{{ error }}</p>
    <div class="nasq-form-footer justify-end sm:col-span-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || isPending || !name.trim() || !selectedProjectId">{{ t('app.create') }}</Button>
    </div>
  </form>
</template>
