<script setup lang="ts">
import { ProjectTemplateCreateSchema, type ProjectTemplateCreate, type ProjectTemplateDefinition, type ProjectTemplate } from '@nasq/contracts'

const props = withDefaults(defineProps<{ template?: ProjectTemplate; busy?: boolean; resetKey?: number }>(), { busy: false, resetKey: 0 })
const emit = defineEmits<{ save: [ProjectTemplateCreate]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const disabled = computed(() => !hydrated.value || props.busy)

type Draft = ProjectTemplateCreate
const blankDefinition = (): ProjectTemplateDefinition => ({ stages: [{ key: 'stage-1', name: '', fold: false }], milestones: [], tasks: [] })
const draft = reactive<Draft>({
  name: props.template?.name ?? '',
  description: props.template?.description ?? '',
  definition: JSON.parse(JSON.stringify(props.template?.definition ?? blankDefinition())),
})
const serialized = () => JSON.stringify(draft)
const baseline = ref(serialized())
const validationError = ref('')
const dirty = computed(() => serialized() !== baseline.value)
const stageOptions = computed(() => draft.definition.stages)
const milestoneOptions = computed(() => draft.definition.milestones)
const taskOptions = computed(() => draft.definition.tasks)
const stageItems = computed(() => stageOptions.value.map(stage => ({
  value: stage.key,
  label: stage.name || t('projects.templates.fields.stage'),
})))
const milestoneItems = computed(() => [
  { value: ':no-milestone:', label: t('projects.templates.none') },
  ...milestoneOptions.value.map(milestone => ({
    value: milestone.key,
    label: milestone.name || t('projects.templates.fields.milestone'),
  })),
])

function selectMilestone(task: ProjectTemplateCreate['definition']['tasks'][number], value: unknown) {
  task.milestone_key = !value || value === ':no-milestone:' ? null : String(value)
}

function nextKey(prefix: string, keys: string[]) { let index = 1; while (keys.includes(`${prefix}-${index}`)) index += 1; return `${prefix}-${index}` }
function addStage() { if (disabled.value) return; draft.definition.stages.push({ key: nextKey('stage', draft.definition.stages.map(row => row.key)), name: '', fold: false }) }
function removeStage(index: number) {
  if (disabled.value || draft.definition.stages.length <= 1) return
  const stage = draft.definition.stages[index]
  if (draft.definition.tasks.some(task => task.stage_key === stage?.key)) {
    validationError.value = t('projects.templates.validation.stageInUse')
    return
  }
  draft.definition.stages.splice(index, 1)
  validationError.value = ''
}
function addMilestone() { if (disabled.value) return; draft.definition.milestones.push({ key: nextKey('milestone', draft.definition.milestones.map(row => row.key)), name: '', offset_days: 0 }) }
function removeMilestone(index: number) {
  if (disabled.value) return
  const [removed] = draft.definition.milestones.splice(index, 1)
  for (const task of draft.definition.tasks) if (task.milestone_key === removed?.key) task.milestone_key = null
}
function addTask() {
  if (disabled.value) return
  draft.definition.tasks.push({ key: nextKey('task', draft.definition.tasks.map(row => row.key)), name: '', stage_key: draft.definition.stages[0]?.key ?? 'stage-1', start_offset: 0, duration_days: 1, milestone_key: null, dependency_keys: [] })
}
function removeTask(index: number) {
  if (disabled.value) return
  const [removed] = draft.definition.tasks.splice(index, 1)
  for (const task of draft.definition.tasks) task.dependency_keys = task.dependency_keys.filter(key => key !== removed?.key)
}
function setNumber(current: number, value: number | null | undefined, fallback: number) {
  return value == null ? fallback : value
}
function setDependency(keys: string[], key: string, checked: boolean | 'indeterminate') {
  const on = checked === true
  const index = keys.indexOf(key)
  if (on && index < 0) keys.push(key)
  if (!on && index >= 0) keys.splice(index, 1)
}
function submit() {
  if (!hydrated.value || props.busy) return
  validationError.value = ''
  const payload = JSON.parse(JSON.stringify(draft)) as ProjectTemplateCreate
  const result = ProjectTemplateCreateSchema.safeParse(payload)
  if (!result.success) {
    const issue = result.error.issues[0]
    const graphErrors = ['duplicateReference', 'missingStage', 'missingMilestone', 'missingDependency', 'dependencyCycle']
    const key = issue?.code === 'custom' && graphErrors.includes(issue.message) ? issue.message : 'invalidFields'
    validationError.value = t(`projects.templates.validation.${key}`)
    return
  }
  emit('save', result.data)
}
watch(() => props.resetKey, () => { baseline.value = serialized(); validationError.value = '' })
</script>

<template>
  <form class="space-y-6" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <fieldset :disabled="disabled" class="grid gap-6">
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('projects.templates.fields.name')" required>
        <UInput :disabled="disabled" v-model="draft.name" name="template-name" class="w-full" required maxlength="255" />
      </UFormField>
      <UFormField :label="t('projects.templates.fields.description')">
        <UInput :disabled="disabled" v-model="draft.description" name="template-description" class="w-full" />
      </UFormField>
    </div>

    <UCard>
      <template #header>
        <div class="flex w-full items-center justify-between gap-3">
          <div>
          <h2 id="template-stages-title" class="text-lg font-semibold text-highlighted">{{ t('projects.templates.stages.title') }}</h2>
            <p class="text-xs text-muted">{{ t('projects.templates.stages.hint') }}</p>
          </div>
          <UButton type="button" color="neutral" :disabled="disabled" @click="addStage" variant="outline">{{ t('projects.templates.actions.addStage') }}</UButton>
        </div>
      </template>
      <div v-for="(stage, index) in draft.definition.stages" :key="stage.key" class="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] last:mb-0">
        <UFormField :label="t('projects.templates.fields.name')">
          <UInput :id="`stage-name-${index}`" :disabled="disabled" v-model="stage.name" :name="`stage-name-${index}`" class="w-full" required />
        </UFormField>
        <UButton type="button" color="neutral" variant="ghost" :disabled="draft.definition.stages.length === 1 || disabled" @click="removeStage(index)">{{ t('projects.templates.actions.remove') }}</UButton>
        <UCheckbox :id="`stage-fold-${index}`" :disabled="disabled" :model-value="stage.fold" :name="`stage-fold-${index}`" :label="t('projects.templates.fields.fold')" class="sm:col-start-1" @update:model-value="stage.fold = $event === true" />
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex w-full items-center justify-between gap-3">
          <h2 id="template-milestones-title" class="text-lg font-semibold text-highlighted">{{ t('projects.templates.milestones.title') }}</h2>
          <UButton type="button" color="neutral" :disabled="disabled" @click="addMilestone" variant="outline">{{ t('projects.templates.actions.addMilestone') }}</UButton>
        </div>
      </template>
      <p v-if="!draft.definition.milestones.length" class="text-sm text-muted">{{ t('projects.templates.emptyMilestones') }}</p>
      <div v-for="(milestone, index) in draft.definition.milestones" :key="milestone.key" class="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] last:mb-0">
        <UFormField :label="t('projects.templates.fields.milestoneName')">
          <UInput :id="`milestone-name-${index}`" :disabled="disabled" v-model="milestone.name" :name="`milestone-name-${index}`" class="w-full" required />
        </UFormField>
        <UFormField :label="t('projects.templates.fields.offset')">
          <UInputNumber
            :id="`milestone-offset-${index}`"
            :disabled="disabled"
            :model-value="milestone.offset_days"
            :name="`milestone-offset-${index}`"
            class="w-full"
            :min="-3650"
            :max="3650"
            required
            @update:model-value="milestone.offset_days = setNumber(milestone.offset_days, $event, 0)"
          />
        </UFormField>
        <UButton type="button" color="neutral" variant="ghost" :disabled="disabled" @click="removeMilestone(index)">{{ t('projects.templates.actions.remove') }}</UButton>
      </div>
      <p class="text-xs text-muted">{{ t('projects.templates.fields.offsetHint') }}</p>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex w-full items-center justify-between gap-3">
          <div>
          <h2 id="template-tasks-title" class="text-lg font-semibold text-highlighted">{{ t('projects.templates.tasks.title') }}</h2>
            <p class="text-xs text-muted">{{ t('projects.templates.tasks.hint') }}</p>
          </div>
          <UButton type="button" color="neutral" :disabled="disabled" @click="addTask" variant="outline">{{ t('projects.templates.actions.addTask') }}</UButton>
        </div>
      </template>
      <p v-if="!draft.definition.tasks.length" class="text-sm text-muted">{{ t('projects.templates.emptyTasks') }}</p>
      <div v-for="(task, index) in draft.definition.tasks" :key="task.key" class="mb-3 space-y-2 rounded-md border border-default p-3 last:mb-0">
        <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <UFormField :label="t('projects.templates.fields.taskName')">
            <UInput :id="`task-name-${index}`" :disabled="disabled" v-model="task.name" :name="`task-name-${index}`" class="w-full" required />
          </UFormField>
          <UButton type="button" color="neutral" variant="ghost" :disabled="disabled" @click="removeTask(index)">{{ t('projects.templates.actions.remove') }}</UButton>
        </div>
        <div class="grid gap-2 sm:grid-cols-4">
          <UFormField :label="t('projects.templates.fields.stage')">
            <USelect
              :disabled="disabled"
              :model-value="task.stage_key"
              :items="stageItems"
              :name="`task-stage-${index}`"
              :aria-label="t('projects.templates.fields.stage')"
              class="w-full"
              @update:model-value="task.stage_key = String($event ?? task.stage_key)"
            />
          </UFormField>
          <UFormField :label="t('projects.templates.fields.startOffset')">
            <UInputNumber
              :disabled="disabled"
              :model-value="task.start_offset"
              :name="`task-start-${index}`"
              :aria-label="t('projects.templates.fields.startOffset')"
              class="w-full"
              :min="-3650"
              :max="3650"
              required
              @update:model-value="task.start_offset = setNumber(task.start_offset, $event, 0)"
            />
          </UFormField>
          <UFormField :label="t('projects.templates.fields.duration')">
            <UInputNumber
              :disabled="disabled"
              :model-value="task.duration_days"
              :name="`task-duration-${index}`"
              :aria-label="t('projects.templates.fields.duration')"
              class="w-full"
              :min="1"
              :max="3650"
              required
              @update:model-value="task.duration_days = setNumber(task.duration_days, $event, 1)"
            />
          </UFormField>
          <UFormField :label="t('projects.templates.fields.milestone')">
            <USelect
              :disabled="disabled"
              :model-value="task.milestone_key ?? ':no-milestone:'"
              :items="milestoneItems"
              :name="`task-milestone-${index}`"
              :aria-label="t('projects.templates.fields.milestone')"
              class="w-full"
              @update:model-value="selectMilestone(task, $event)"
            />
          </UFormField>
        </div>
        <p class="text-xs text-muted">{{ t('projects.templates.fields.offsetHint') }}</p>
        <fieldset :disabled="disabled" class="grid gap-2 text-xs">
          <legend>{{ t('projects.templates.fields.dependencies') }}</legend>
          <div class="grid gap-2 rounded-md border border-default bg-default p-2 sm:grid-cols-2">
            <template v-if="taskOptions.some(item => item.key !== task.key)">
              <UCheckbox
                v-for="candidate in taskOptions.filter(item => item.key !== task.key)"
                :key="candidate.key"
                :id="`task-dependency-${index}-${candidate.key}`"
                :name="`task-dependency-${index}-${candidate.key}`"
                :model-value="task.dependency_keys.includes(candidate.key)"
                :label="candidate.name || t('projects.templates.fields.taskName')"
                @update:model-value="setDependency(task.dependency_keys, candidate.key, $event)"
              />
            </template>
            <p v-else class="text-muted col-span-2">{{ t('projects.templates.noPredecessors') }}</p>
          </div>
        </fieldset>
      </div>
    </UCard>
    <UAlert v-if="validationError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="validationError" />
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" :disabled="disabled" @click="emit('cancel')" variant="outline">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :disabled="disabled">{{ t('app.save') }}</UButton>
    </div>
    </fieldset>
  </form>
</template>
