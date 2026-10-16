<script setup lang="ts">
import MyTaskForm from '@/components/personal-tasks/MyTaskForm.vue'
import { ApiError } from '@/composables/useApi'
import { useMyTask, useUpdateMyTask, type MyTaskBody } from '@/composables/useMyTasks'
import { recordEntryOrigin, recordParentTo } from '@/utils/recordListOrigin'
import { myTaskFormField } from '@/utils/myTaskPayload'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const taskId = computed(() => {
  const id = Number(route.params.id)
  return Number.isInteger(id) && id > 0 ? id : null
})
const { data: task, isLoading, error: readError, refetch } = useMyTask(taskId)
const { mutateAsync: update, isPending, error, reset } = useUpdateMyTask()
const pageError = computed(() => taskId.value === null ? new ApiError(404, 'not_found', t('errors.notFound')) : readError.value)
const sourcePaths = useRecordListPaths(['/my-tasks'])
const backTo = computed(() => {
  if (taskId.value === null) return { path: '/my-tasks' }
  const back = router.resolve(recordParentTo(`/my-tasks/${taskId.value}`, route.query, sourcePaths.value, route.hash))
  const parent = task.value?.parent
  const origin = parent ? recordEntryOrigin(route.query.listOrigin, `/my-tasks/${parent.id}`, sourcePaths.value) : undefined
  return { path: back.path, query: { ...back.query, ...(origin ? { returnTo: origin } : {}) }, hash: back.hash }
})
const form = ref<InstanceType<typeof MyTaskForm> | null>(null)
let saving = false
async function save(body: MyTaskBody) {
  if (saving || taskId.value === null) return
  saving = true
  reset()
  try {
    if (Object.keys(body).length) await update({ id: taskId.value, body })
    form.value?.markSaved()
    await router.replace(backTo.value)
  } catch (cause) {
    if (!(cause instanceof ApiError && myTaskFormField(cause.field))) {
      toast.add({ title: cause instanceof Error ? cause.message : t('myTasks.errors.save'), color: 'error' })
    }
  } finally { saving = false }
}
</script>

<template>
  <SharedRecordPage :title="t('myTasks.form.editTitle')" :back-to="backTo" :back-label="t(taskId === null ? 'myTasks.detail.back' : 'myTasks.form.backToTask')" :loading="!task && isLoading" :error="pageError" :keep-content="!!task" @retry="refetch">
    <SharedForbiddenState v-if="task && !task.allowed_actions.write" />
    <MyTaskForm v-else-if="task" :key="task.id" ref="form" :task="task" :pending="isPending" :error="error" @update="save" @cancel="router.push(backTo)" />
  </SharedRecordPage>
</template>
