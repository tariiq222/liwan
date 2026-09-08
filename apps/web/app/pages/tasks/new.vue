<script setup lang="ts">
import { toast } from 'vue-sonner'
import TaskCreateForm from '@/components/task/TaskCreateForm.vue'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/tasks', ['/tasks', '/projects']))
function created(id: number) {
  toast.success(t('tasks.created'))
  router.push({ path: '/tasks/' + id, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('tasks.new')" :back-to="returnTo" :back-label="t('tasks.detail.back')" />
    <section class="nasq-form nasq-panel nasq-panel-body">
      <TaskCreateForm @created="created" @cancel="router.push(returnTo)" />
    </section>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedPageContainer>
</template>
