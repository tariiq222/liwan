<script setup lang="ts">
import MyTaskForm from '@/components/my-tasks/MyTaskForm.vue'
import { useCreateMyTask } from '@/composables/useMyTasks'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/my-tasks', ['/my-tasks']))
const { mutateAsync, isPending, error, reset } = useCreateMyTask()
const form = ref<InstanceType<typeof MyTaskForm> | null>(null)

async function create(payload: Parameters<typeof mutateAsync>[0]) {
  reset()
  try {
    const task = await mutateAsync(payload)
    form.value?.markSaved()
    toast.add({ title: t('myTasks.created'), color: 'success' })
    // Hand the list's own query to the new task so its back link restores that view.
    await router.push({ path: `/my-tasks/${task.id}`, query: router.resolve(returnTo.value).query })
  } catch (e) {
    toast.add({ title: e instanceof Error && e.message ? e.message : t('myTasks.errors.save'), color: 'error' })
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('myTasks.form.createTitle')" :back-to="returnTo">
    <MyTaskForm ref="form" mode="create" :pending="isPending" :error="error" @submit="create" @cancel="router.push(returnTo)" />
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
