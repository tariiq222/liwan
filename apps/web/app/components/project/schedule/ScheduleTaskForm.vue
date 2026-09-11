<script setup lang="ts">
import { ScheduleTaskPatchSchema, type Milestone, type ScheduleTask } from '@nasq/contracts'
import { useUpdateProjectScheduleTask } from '@/composables/useProjectSchedule'
import { ApiError } from '@/composables/useApi'
import { validateTaskDates } from '@/utils/projectDateBounds'

const props = defineProps<{
  projectId: number
  task: ScheduleTask
  returnTo: string
  milestone?: Pick<Milestone, 'start_date' | 'deadline'> | null
  projectStart?: string | null
  projectEnd?: string | null
}>()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const update = useUpdateProjectScheduleTask()
const start = ref(props.task.start ?? '')
const end = ref(props.task.end ?? '')
const initial = ref(JSON.stringify({ start: start.value, end: end.value }))
const dirty = computed(() => JSON.stringify({ start: start.value, end: end.value }) !== initial.value)
const errorMessage = ref('')
const startModel = computed({
  get: () => start.value || null,
  set: (value: string | null) => { start.value = value ?? '' },
})
const endModel = computed({
  get: () => end.value || null,
  set: (value: string | null) => { end.value = value ?? '' },
})

async function save() {
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
  try {
    await update.mutateAsync({ projectId: props.projectId, taskId: props.task.id, patch: parsed.data })
    initial.value = JSON.stringify({ start: start.value, end: end.value })
    toast.add({ title: t('projects.schedule.saved'), color: 'success' })
    await nextTick()
    await router.push(props.returnTo)
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : t('projects.schedule.saveError')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form class="space-y-6" @submit.prevent="save">
    <div>
      <h2 class="text-lg font-semibold text-highlighted">{{ task.name }}</h2>
      <p class="text-sm text-muted">{{ t('projects.schedule.editDescription') }}</p>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('projects.schedule.start')">
        <SharedDateField
          :min-value="props.milestone?.start_date ?? props.projectStart"
          :max-value="props.milestone?.deadline ?? props.projectEnd"
          id="planned-start"
          v-model="startModel"
          :disabled="!hydrated || !task || update.isPending.value"
          :aria-label="t('projects.schedule.start')"
        />
      </UFormField>
      <UFormField :label="t('projects.schedule.end')">
        <SharedDateField
          :min-value="props.milestone?.start_date ?? props.projectStart"
          :max-value="props.milestone?.deadline ?? props.projectEnd"
          id="planned-end"
          v-model="endModel"
          :disabled="!hydrated || !task || update.isPending.value"
          :aria-label="t('projects.schedule.end')"
        />
      </UFormField>
    </div>
    <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="errorMessage" />
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" :disabled="!hydrated || update.isPending.value" @click="router.push(returnTo)" variant="outline">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :disabled="!hydrated || update.isPending.value">{{ t('app.save') }}</UButton>
    </div>
  </form>
</template>
