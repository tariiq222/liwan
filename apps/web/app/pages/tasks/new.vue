<script setup lang="ts">
import TaskCreateForm from '@/components/pmo/tasks/TaskCreateForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const sourcePaths = useRecordListPaths(['/tasks'])
const returnTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
function created(id: number) {
  toast.add({ title: t('tasks.created'), color: 'success' })
  router.replace({ path: '/tasks/' + id, query: { returnTo: returnTo.value } })
}
</script>

<template>
  <SharedCreatePanel :title="t('tasks.new')" :back-to="returnTo">
    <TaskCreateForm mode="project" @created="created" @cancel="router.push(returnTo)" />
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedCreatePanel>
</template>
