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
const plannedStart = ref<string | null>(null)
const dateDeadline = ref<string | null>(null)
const error = ref<string | null>(null)
// Which field the current error belongs to, so it renders under that field.
// Errors without a visible owning field stay in the form-level alert.
const errorField = ref<string | null>(null)
const submitted = ref(false)
// Local required-field attempts must not mark the draft as successfully saved.
const requiredAttempted = ref(false)
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
// Non-quick hosts never collapse; quick-create starts folded.
const optionalOpen = ref(props.mode !== 'project')
// Guided creation in a project with dated milestones requires a milestone and both dates.
const scheduleRequired = computed(() => guided.value && hasDatedMilestones.value)

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

function seedProjectSelection() {
    if (props.projectId) selectedProjectId.value = props.projectId
    else if (!selectedProjectId.value) selectedProjectId.value = projects.value?.[0]?.id
    // A project refetch can retrigger this watcher while a user is still
    // drafting content. Keep that draft dirty until it is submitted.
    if (!hasDraftValues.value && !submitted.value) baseline.value = state()
}
watch(
  () => [props.projectId, projects.value] as const,
  seedProjectSelection,
  { immediate: true, flush: 'sync' },
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

const visibleErrorFields = computed(() => {
  const fields = ['name', 'project_id']
  if (canManageDates.value) fields.push('planned_start', 'date_deadline')
  if (selectedProjectId.value && canManageDates.value) fields.push('milestone_id')
  return fields
})
const generalError = computed(() => errorField.value && visibleErrorFields.value.includes(errorField.value) ? null : error.value)

function fieldError(field: string): string | undefined {
  if (requiredAttempted.value) {
    if (field === 'name') return !name.value.trim() ? t('tasks.nameRequired') : undefined
    if (field === 'project_id') return !selectedProjectId.value ? t('tasks.projectRequired') : undefined
  }
  return errorField.value === field && visibleErrorFields.value.includes(field) ? error.value ?? undefined : undefined
}

function policyErrorField(key: string): string | null {
  if (key === 'tasks.milestoneRequired') return 'milestone_id'
  if (key === 'tasks.scheduleRequired') return plannedStart.value ? 'date_deadline' : 'planned_start'
  return null
}

async function submit() {
  if (!hydrated.value || isPending.value) return
  requiredAttempted.value = true
  error.value = null
  errorField.value = null
  const trimmed = name.value.trim()
  if (!trimmed || !selectedProjectId.value) {
    errorField.value = !trimmed ? 'name' : 'project_id'
    error.value = t(!trimmed ? 'tasks.nameRequired' : 'tasks.projectRequired')
    return
  }
  requiredAttempted.value = false
  if (policyError.value) {
    error.value = t(policyError.value)
    errorField.value = policyErrorField(policyError.value)
    return
  }
  if (dateError.value) {
    error.value = dateErrorText(dateError.value)
    errorField.value = dateError.value.startsWith('task.start') ? 'planned_start' : 'date_deadline'
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
    errorField.value = e instanceof ApiError ? e.field ?? null : null
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form novalidate data-testid="task-create-form" class="grid gap-5" @submit.prevent="submit">
    <UAlert v-if="generalError" role="alert" class="sm:col-span-2" color="error" variant="subtle" :title="generalError" />
    <UFormField :label="t('tasks.newTitle')" name="name" required :error="fieldError('name')">
      <UInput id="new-task-name" v-model="name" required class="w-full" :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField v-if="selectedProjectId && canManageDates" :label="t('tasks.drawer.milestone')" name="milestone_id" :required="scheduleRequired" :error="fieldError('milestone_id')">
      <USelect
        id="new-task-milestone"
        class="w-full"
        :items="[{ label: t('tasks.drawer.noMilestone'), value: 'none' }, ...milestoneOptions.map((milestone) => ({ label: milestone.name, value: String(milestone.id) }))]"
        :model-value="selectedMilestoneId ? String(selectedMilestoneId) : 'none'"
        :disabled="!hydrated || isPending"
        @update:model-value="(v) => (selectedMilestoneId = v && v !== 'none' ? Number(v) : undefined)"
      />
    </UFormField>
    <UFormField v-if="canManageDates" :label="t('tasks.schedule.plannedStart')" name="planned_start" :required="scheduleRequired" :error="fieldError('planned_start')">
      <SharedDateField id="new-task-planned-start" :aria-label="t('tasks.schedule.plannedStart')" v-model="plannedStart" :disabled="!hydrated || isPending" :min-value="selectedMilestone?.start_date ?? projectStart ?? undefined" :max-value="selectedMilestone?.deadline ?? projectEnd ?? undefined" />
    </UFormField>
    <UFormField v-if="canManageDates" :label="t('tasks.drawer.deadline')" name="date_deadline" :required="scheduleRequired" :error="fieldError('date_deadline')">
      <SharedDateField id="new-task-deadline" :aria-label="t('tasks.drawer.deadline')" v-model="dateDeadline" :disabled="!hydrated || isPending" :min-value="selectedMilestone?.start_date ?? projectStart ?? undefined" :max-value="selectedMilestone?.deadline ?? projectEnd ?? undefined" />
    </UFormField>
    <UFormField :label="t('tasks.project')" name="project_id" required :error="fieldError('project_id')">
      <p v-if="props.projectId" id="new-task-project" class="text-sm">{{ lockedProjectName }}</p>
      <USelect
        v-else
        id="new-task-project"
        class="w-full"
        :items="(projects ?? []).map((p) => ({ label: p.name, value: String(p.id) }))"
        :model-value="selectedProjectId ? String(selectedProjectId) : undefined"
        :placeholder="t('tasks.project')"
        :disabled="!hydrated || isPending"
        @update:model-value="selectProject"
      />
    </UFormField>
    <!-- Project quick-create folds the optional fields behind a trigger; every other host shows them. -->
    <UCollapsible
      v-model:open="optionalOpen"
      :data-testid="projectQuick ? 'task-create-optional' : undefined"
      :class="projectQuick ? 'rounded-lg border border-default p-4' : undefined"
    >
      <UButton v-if="projectQuick" type="button" color="neutral" variant="ghost" class="w-full justify-between font-semibold" trailing-icon="i-lucide-chevron-down" :ui="{ trailingIcon: 'transition-transform group-data-[state=open]:rotate-180' }">{{ t('tasks.quick.optional') }}</UButton>
      <template #content>
        <div class="grid gap-6" :class="projectQuick && 'pt-4'">
          <UFormField :label="t('tasks.drawer.description')" name="description" class="sm:col-span-2">
            <UTextarea id="new-task-description" v-model="description" class="w-full" :rows="4" :placeholder="t('tasks.descriptionField.placeholder')" :disabled="!hydrated || isPending" />
          </UFormField>
          <UFormField :label="t('tasks.deliverables.title')" :description="t('tasks.deliverables.hint')" name="deliverables" class="sm:col-span-2">
            <div class="grid gap-2">
              <div v-if="deliverables.length" class="space-y-2">
                <div v-for="(item, index) in deliverables" :key="index" class="flex items-center gap-2">
                  <UInput v-model="item.name" class="flex-1" :aria-label="t('tasks.deliverables.name')" :disabled="!hydrated || isPending" />
                  <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-x" :disabled="!hydrated || isPending" :aria-label="t('tasks.deliverables.remove')" @click="removeDeliverable(index)" />
                </div>
              </div>
              <p v-else class="text-sm text-muted">{{ t('tasks.deliverables.empty') }}</p>
              <div>
                <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!hydrated || isPending" @click="addDeliverable">{{ t('tasks.deliverables.add') }}</UButton>
              </div>
            </div>
          </UFormField>
        </div>
      </template>
    </UCollapsible>
    <div class="flex flex-wrap gap-2 justify-end sm:col-span-2">
      <UButton color="neutral" variant="outline" type="button" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :loading="isPending" :disabled="!hydrated || isPending">{{ t('app.create') }}</UButton>
    </div>
  </form>
</template>
