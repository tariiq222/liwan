<script setup lang="ts">
import { ScheduleTaskPatchSchema, type Milestone, type ScheduleTask } from '@liwan/contracts'
import { useUpdateProjectScheduleTask } from '@/composables/useProjectSchedule'
import { ApiError } from '@/composables/useApi'
import { validateTaskDates } from '@/utils/projectDateBounds'

const props = defineProps<{
  projectId: number
  task: ScheduleTask
  canWrite?: boolean
  milestone?: Pick<Milestone, 'start_date' | 'deadline'> | null
  projectStart?: string | null
  projectEnd?: string | null
}>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const update = useUpdateProjectScheduleTask()
const start = ref(props.task.start ?? '')
const end = ref(props.task.end ?? '')
const draftPair = computed(() => datePairSnapshot({ start: start.value, end: end.value }))
const serverPair = computed(() => datePairSnapshot(props.task))
const initial = ref(draftPair.value)
const dirty = computed(() => draftPair.value !== initial.value)
const errorMessage = ref('')
const confirmDiscard = ref(false)
const discardAction = ref<'cancel' | 'reload'>('cancel')
const changed = ref(false)
const saving = ref(false)
const pending = computed(() => saving.value || update.isPending.value)
const disabled = computed(() => !hydrated.value || props.canWrite === false || pending.value || changed.value)
let identityVersion = 0
onBeforeUnmount(() => { identityVersion += 1 })
watch([() => props.projectId, () => props.task.id], () => {
  identityVersion += 1
  resetDraft()
}, { flush: 'sync' })
watch(serverPair, value => {
  changed.value = value !== initial.value
}, { flush: 'sync' })

function datePairSnapshot(task: Pick<ScheduleTask, 'start' | 'end'>) {
  return JSON.stringify({ start: task.start ?? '', end: task.end ?? '' })
}
function resetDraft() {
  start.value = props.task.start ?? ''
  end.value = props.task.end ?? ''
  initial.value = draftPair.value
  changed.value = false
  errorMessage.value = ''
  confirmDiscard.value = false
}
const startModel = computed({
  get: () => start.value || null,
  set: (value: string | null) => { if (!disabled.value) start.value = value ?? '' },
})
const endModel = computed({
  get: () => end.value || null,
  set: (value: string | null) => { if (!disabled.value) end.value = value ?? '' },
})

async function save() {
  if (disabled.value || !dirty.value || confirmDiscard.value) return
  errorMessage.value = ''
  const parsed = ScheduleTaskPatchSchema.safeParse({ start: start.value || null, end: end.value || null })
  if (!parsed.success) {
    errorMessage.value = t('projects.schedule.invalidDates')
    return
  }
  const boundsError = validateTaskDates({
    milestoneStart: props.milestone?.start_date ?? props.projectStart,
    milestoneDeadline: props.milestone?.deadline ?? props.projectEnd,
    plannedStart: start.value || null,
    dateDeadline: end.value || null,
  })
  if (boundsError) {
    errorMessage.value = t(`projects.schedule.${boundsError.split('.').pop()}`)
    return
  }
  const version = identityVersion
  saving.value = true
  try {
    const savedTask = await update.mutateAsync({ projectId: props.projectId, taskId: props.task.id, patch: parsed.data })
    if (version !== identityVersion) return
    const savedPair = datePairSnapshot(savedTask)
    if (serverPair.value !== initial.value && serverPair.value !== savedPair) {
      changed.value = true
      return
    }
    start.value = savedTask.start ?? ''
    end.value = savedTask.end ?? ''
    initial.value = savedPair
    changed.value = false
    await nextTick()
    if (version !== identityVersion || changed.value) return
    toast.add({ title: t('projects.schedule.saved'), color: 'success' })
    emit('saved')
  } catch (error) {
    if (version !== identityVersion) return
    errorMessage.value = error instanceof ApiError ? error.message : t('projects.schedule.saveError')
  } finally {
    saving.value = false
  }
}
async function cancel() {
  if (!hydrated.value || pending.value) return
  if (dirty.value) { discardAction.value = 'cancel'; confirmDiscard.value = true; return }
  emit('cancel')
}
function reload() {
  if (!hydrated.value || pending.value) return
  if (dirty.value) { discardAction.value = 'reload'; confirmDiscard.value = true; return }
  resetDraft()
}
async function discard() {
  if (!hydrated.value || pending.value) return
  const version = identityVersion
  const action = discardAction.value
  resetDraft()
  await nextTick()
  if (version !== identityVersion) return
  if (action === 'cancel') emit('cancel')
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
  <form data-testid="project-task-schedule-form" class="space-y-6" @submit.prevent="save">
    <UAlert color="warning" variant="subtle" :title="t('projects.schedule.deadlineEffect')" />
    <UAlert v-if="props.canWrite === false" color="warning" variant="subtle" :title="t('projects.schedule.readOnly')" />
    <UAlert v-if="changed" role="alert" color="warning" variant="subtle" :title="t('projects.schedule.changed')">
      <template #actions><UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || pending" @click="reload">{{ t('projects.schedule.reload') }}</UButton></template>
    </UAlert>
    <SharedInlineConfirm v-if="confirmDiscard" :title="t('app.unsavedChangesTitle')" :description="t('app.unsavedChanges')" :confirm-label="t(discardAction === 'reload' ? 'projects.schedule.reload' : 'projects.schedule.discard')" @confirm="discard" @cancel="confirmDiscard = false" />
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('projects.schedule.start')">
        <SharedDateField
          :min-value="props.milestone?.start_date ?? props.projectStart"
          :max-value="props.milestone?.deadline ?? props.projectEnd"
          id="planned-start"
          v-model="startModel"
          :disabled="disabled"
          :aria-label="t('projects.schedule.start')"
        />
      </UFormField>
      <UFormField :label="t('projects.schedule.end')">
        <SharedDateField
          :min-value="props.milestone?.start_date ?? props.projectStart"
          :max-value="props.milestone?.deadline ?? props.projectEnd"
          id="planned-end"
          v-model="endModel"
          :disabled="disabled"
          :aria-label="t('projects.schedule.end')"
        />
      </UFormField>
    </div>
    <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="errorMessage" />
    <SharedFormActions class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" :disabled="!hydrated || pending" @click="cancel" variant="outline">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :disabled="disabled || !dirty || confirmDiscard" :loading="pending">{{ t('app.save') }}</UButton>
    </SharedFormActions>
  </form>
</template>
