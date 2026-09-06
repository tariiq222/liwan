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
  <section class="mx-auto w-full max-w-2xl space-y-6">
    <SharedPageHeader :title="t('tasks.new')" :back-to="returnTo" :back-label="t('tasks.detail.back')" />
    <Card><CardContent class="pt-6"><TaskCreateForm @created="created" @cancel="router.push(returnTo)" /></CardContent></Card>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </section>
</template>
