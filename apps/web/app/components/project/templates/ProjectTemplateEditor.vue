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
    <fieldset :disabled="disabled" class="contents">
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="grid gap-1 text-sm"><span>{{ t('projects.templates.fields.name') }}</span><Input :disabled="disabled" v-model="draft.name" name="template-name" required maxlength="255" /></label>
      <label class="grid gap-1 text-sm"><span>{{ t('projects.templates.fields.description') }}</span><Input :disabled="disabled" v-model="draft.description" name="template-description" /></label>
    </div>

    <section class="space-y-3 rounded-lg border p-4" aria-labelledby="template-stages-title">
      <div class="flex items-center justify-between gap-3"><div><h2 id="template-stages-title" class="font-medium">{{ t('projects.templates.stages.title') }}</h2><p class="text-xs text-muted-foreground">{{ t('projects.templates.stages.hint') }}</p></div><Button type="button" variant="outline" :disabled="disabled" @click="addStage">{{ t('projects.templates.actions.addStage') }}</Button></div>
      <div v-for="(stage, index) in draft.definition.stages" :key="stage.key" class="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <span class="text-xs text-muted-foreground">{{ stage.name || t('projects.templates.fields.stage') }}</span>
        <Input :disabled="disabled" v-model="stage.name" :name="`stage-name-${index}`" :aria-label="t('projects.templates.fields.name')" required />
        <Button type="button" variant="ghost" :disabled="draft.definition.stages.length === 1 || disabled" @click="removeStage(index)">{{ t('projects.templates.actions.remove') }}</Button>
        <label class="flex items-center gap-2 text-xs sm:col-start-2"><input :disabled="disabled" v-model="stage.fold" :name="`stage-fold-${index}`" type="checkbox" /> {{ t('projects.templates.fields.fold') }}</label>
      </div>
    </section>

    <section class="space-y-3 rounded-lg border p-4" aria-labelledby="template-milestones-title">
      <div class="flex items-center justify-between gap-3"><div><h2 id="template-milestones-title" class="font-medium">{{ t('projects.templates.milestones.title') }}</h2><p class="text-xs text-muted-foreground">{{ t('projects.templates.milestones.hint') }}</p></div><Button type="button" variant="outline" :disabled="disabled" @click="addMilestone">{{ t('projects.templates.actions.addMilestone') }}</Button></div>
      <p v-if="!draft.definition.milestones.length" class="text-sm text-muted-foreground">{{ t('projects.templates.emptyMilestones') }}</p>
      <div v-for="(milestone, index) in draft.definition.milestones" :key="milestone.key" class="grid gap-2 sm:grid-cols-[1fr_8rem_auto]"><Input :disabled="disabled" v-model="milestone.name" :name="`milestone-name-${index}`" :aria-label="t('projects.templates.fields.milestoneName')" required /><Input :disabled="disabled" v-model.number="milestone.offset_days" :name="`milestone-offset-${index}`" :aria-label="t('projects.templates.fields.offset')" type="number" min="-3650" max="3650" required /><Button type="button" variant="ghost" :disabled="disabled" @click="removeMilestone(index)">{{ t('projects.templates.actions.remove') }}</Button></div>
      <p class="text-xs text-muted-foreground">{{ t('projects.templates.fields.offsetHint') }}</p>
    </section>

    <section class="space-y-3 rounded-lg border p-4" aria-labelledby="template-tasks-title">
      <div class="flex items-center justify-between gap-3"><div><h2 id="template-tasks-title" class="font-medium">{{ t('projects.templates.tasks.title') }}</h2><p class="text-xs text-muted-foreground">{{ t('projects.templates.tasks.hint') }}</p></div><Button type="button" variant="outline" :disabled="disabled" @click="addTask">{{ t('projects.templates.actions.addTask') }}</Button></div>
      <p v-if="!draft.definition.tasks.length" class="text-sm text-muted-foreground">{{ t('projects.templates.emptyTasks') }}</p>
      <div v-for="(task, index) in draft.definition.tasks" :key="task.key" class="space-y-2 rounded-md border p-3">
        <div class="grid gap-2 sm:grid-cols-[1fr_auto]"><Input :disabled="disabled" v-model="task.name" :name="`task-name-${index}`" :aria-label="t('projects.templates.fields.taskName')" required /><Button type="button" variant="ghost" :disabled="disabled" @click="removeTask(index)">{{ t('projects.templates.actions.remove') }}</Button></div>
        <div class="grid gap-2 sm:grid-cols-4"><label class="grid gap-1 text-xs"><span>{{ t('projects.templates.fields.stage') }}</span><select :disabled="disabled" v-model="task.stage_key" :name="`task-stage-${index}`" :aria-label="t('projects.templates.fields.stage')" class="h-9 rounded-md border bg-background px-2"><option v-for="stage in stageOptions" :key="stage.key" :value="stage.key">{{ stage.name || t('projects.templates.fields.stage') }}</option></select></label><label class="grid gap-1 text-xs"><span>{{ t('projects.templates.fields.startOffset') }}</span><Input :disabled="disabled" v-model.number="task.start_offset" :name="`task-start-${index}`" :aria-label="t('projects.templates.fields.startOffset')" type="number" min="-3650" max="3650" required /></label><label class="grid gap-1 text-xs"><span>{{ t('projects.templates.fields.duration') }}</span><Input :disabled="disabled" v-model.number="task.duration_days" :name="`task-duration-${index}`" :aria-label="t('projects.templates.fields.duration')" type="number" min="1" max="3650" required /></label><label class="grid gap-1 text-xs"><span>{{ t('projects.templates.fields.milestone') }}</span><select :disabled="disabled" v-model="task.milestone_key" :name="`task-milestone-${index}`" :aria-label="t('projects.templates.fields.milestone')" class="h-9 rounded-md border bg-background px-2"><option :value="null">{{ t('projects.templates.none') }}</option><option v-for="milestone in milestoneOptions" :key="milestone.key" :value="milestone.key">{{ milestone.name || t('projects.templates.fields.milestone') }}</option></select></label></div>
        <p class="text-xs text-muted-foreground">{{ t('projects.templates.fields.offsetHint') }}</p>
        <label class="grid gap-1 text-xs"><span>{{ t('projects.templates.fields.dependencies') }}</span><select :disabled="disabled" v-model="task.dependency_keys" :name="`task-dependencies-${index}`" :aria-label="t('projects.templates.fields.dependencies')" multiple class="min-h-20 rounded-md border bg-background p-2"><option v-for="candidate in taskOptions.filter(item => item.key !== task.key)" :key="candidate.key" :value="candidate.key">{{ candidate.name || t('projects.templates.fields.taskName') }}</option></select></label>
      </div>
    </section>
    <p v-if="validationError" role="alert" class="text-sm text-destructive">{{ validationError }}</p>
    <div class="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" :disabled="disabled" @click="emit('cancel')">{{ t('app.cancel') }}</Button><Button type="submit" :disabled="disabled">{{ t('app.save') }}</Button></div>
    </fieldset>
  </form>
</template>
