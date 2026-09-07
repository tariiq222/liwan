<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { Task } from '@nasq/contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { ApiError } from '@/composables/useApi'
import { useArchivedTasks, useRestoreTask } from '@/composables/useArchivedTasks'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
watch(q, value => {
  if (value !== String(route.query.q ?? '')) void router.replace({ query: { ...route.query, q: value || undefined } })
})
watch(() => route.query.q, value => { q.value = typeof value === 'string' ? value : '' })
const mine = computed(() => route.query.filter === 'mine')
const params = computed(() => ({ project_id: projectId.value, mine: mine.value, q: q.value.trim() || undefined }))
const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useArchivedTasks(params)
const items = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items))
const total = computed(() => data.value?.pages[0]?.total ?? 0)
const { mutate: restore, isPending } = useRestoreTask()
const backTo = computed(() => safeReturnTo(route.query.returnTo, projectId.value ? `/projects/${projectId.value}` : '/tasks', ['/tasks', '/projects']))

function restoreTask(task: Task) {
  restore({ id: task.id }, {
    onSuccess: () => toast.success(t('taskLifecycle.restored')),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('errors.generic')),
  })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader
      :title="t('taskLifecycle.archivedTasks')"
      :description="t('taskLifecycle.archivedTasksHint')"
      :back-to="backTo"
      :back-label="t('taskLifecycle.back')"
    />

    <div class="nasq-toolbar" data-testid="archived-tasks-toolbar">
      <Input v-model="q" :disabled="!hydrated" :placeholder="t('taskLifecycle.searchArchived')" class="min-w-56 max-w-sm" />
      <Badge v-if="data" variant="secondary">{{ total }}</Badge>
    </div>

    <SharedPageState
      :loading="isLoading && !items.length"
      :error="items.length ? null : error"
      :empty="!items.length"
      :empty-text="t('taskLifecycle.noArchivedTasks')"
      @retry="refetch"
    >
      <div class="nasq-panel overflow-hidden">
        <ul class="divide-y">
          <li v-for="task in items" :key="task.id" class="flex items-center justify-between gap-3 p-3">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ task.name }}</p>
              <p class="truncate text-sm text-muted-foreground">{{ task.project?.name ?? '—' }}</p>
            </div>
            <Button size="sm" type="button" :disabled="!hydrated || isPending" @click="restoreTask(task)">{{ t('taskLifecycle.restore') }}</Button>
          </li>
        </ul>
        <div v-if="hasNextPage" class="border-t p-3 text-center">
          <Button variant="outline" type="button" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">
            {{ t('taskLifecycle.loadMore') }}
          </Button>
        </div>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
