<script setup lang="ts">
import TaskCreateForm from '@/components/task/TaskCreateForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/tasks', ['/tasks', '/archived-tasks', '/projects']))
function created(id: number) {
  toast.add({ title: t('tasks.created'), color: 'success' })
  // Hand the list's own state to the new task as plain query, so its back link
  // restores the view the create was started from without a returnTo chain.
  router.push({ path: '/tasks/' + id, query: router.resolve(returnTo.value).query })
}
</script>

<template>
  <SharedCreatePanel :title="t('tasks.new')" :back-to="returnTo">
    <TaskCreateForm mode="project" @created="created" @cancel="router.push(returnTo)" />
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedCreatePanel>
</template>
