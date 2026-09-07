<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ScheduleTaskPatchSchema, type ScheduleTask } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'

const props = defineProps<{ projectId: number; task: ScheduleTask; returnTo: string }>()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const update = useUpdateProjectScheduleTask()
const start = ref(props.task.start ?? '')
const end = ref(props.task.end ?? '')
const initial = ref(JSON.stringify({ start: start.value, end: end.value }))
const dirty = computed(() => JSON.stringify({ start: start.value, end: end.value }) !== initial.value)
const errorMessage = ref('')

async function save() {
  errorMessage.value = ''
  const parsed = ScheduleTaskPatchSchema.safeParse({ start: start.value || null, end: end.value || null })
  if (!parsed.success) {
    errorMessage.value = t('projects.schedule.invalidDates')
    return
  }
  try {
    await update.mutateAsync({ projectId: props.projectId, taskId: props.task.id, patch: parsed.data })
    initial.value = JSON.stringify({ start: start.value, end: end.value })
    toast.success(t('projects.schedule.saved'))
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
      <h2 class="text-lg font-semibold">{{ task.name }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('projects.schedule.editDescription') }}</p>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2"><Label for="planned-start">{{ t('projects.schedule.start') }}</Label><Input id="planned-start" v-model="start" type="date" :disabled="!hydrated || !task || update.isPending.value" /></div>
      <div class="space-y-2"><Label for="planned-end">{{ t('projects.schedule.end') }}</Label><Input id="planned-end" v-model="end" type="date" :disabled="!hydrated || !task || update.isPending.value" /></div>
    </div>
    <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" :disabled="!hydrated || update.isPending.value" @click="router.push(returnTo)">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || update.isPending.value">{{ t('app.save') }}</Button>
    </div>
  </form>
</template>
