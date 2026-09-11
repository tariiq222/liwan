<script setup lang="ts">
import TaskCreateForm from '@/components/task/TaskCreateForm.vue'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/tasks', ['/tasks', '/archived-tasks', '/projects']))
function created(id: number) {
  toast.add({ title: t('tasks.created'), color: 'success' })
  router.push({ path: '/tasks/' + id, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('tasks.new')" :back-to="returnTo" :back-label="t('tasks.detail.back')" />
    <UCard>
      <TaskCreateForm mode="project" @created="created" @cancel="router.push(returnTo)" />
    </UCard>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedPageContainer>
</template>
