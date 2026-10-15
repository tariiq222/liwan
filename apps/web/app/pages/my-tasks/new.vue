<script setup lang="ts">
import MyTaskForm from '@/components/personal-tasks/MyTaskForm.vue'
import { useCreateMyTask } from '@/composables/useMyTasks'
import { ApiError } from '@/composables/useApi'
import { myTaskFormField } from '@/utils/myTaskPayload'
import { owningListBack } from '@/utils/recordListOrigin'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const sourcePaths = useRecordListPaths(['/my-tasks'])
const returnTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const { mutateAsync, isPending, error, reset } = useCreateMyTask()
const form = ref<InstanceType<typeof MyTaskForm> | null>(null)

// Synchronous in-flight guard: vue-query publishes `isPending` on a later task, so a second submit
// event (double click, Enter then click) could otherwise reach the server before the form disables.
let submitting = false

async function create(payload: Parameters<typeof mutateAsync>[0]) {
  if (submitting) return
  submitting = true
  reset()
  try {
    const task = await mutateAsync(payload)
    form.value?.markSaved()
    toast.add({ title: t('myTasks.created'), color: 'success' })
    await router.replace({ path: `/my-tasks/${task.id}`, query: { returnTo: returnTo.value } })
  } catch (e) {
    // A field error is shown under its field by the form; everything else also gets a toast.
    if (!(e instanceof ApiError && myTaskFormField(e.field))) {
      toast.add({ title: e instanceof Error && e.message ? e.message : t('myTasks.errors.save'), color: 'error' })
    }
  } finally {
    submitting = false
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('myTasks.form.createTitle')" :back-to="returnTo">
    <MyTaskForm ref="form" :pending="isPending" :error="error" @create="create" @cancel="router.push(returnTo)" />
  </SharedCreatePanel>
</template>
