<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useNotificationDigest } from '@/composables/useNotifications'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => {
  const raw = Number(route.params.id)
  return Number.isInteger(raw) && raw > 0 ? raw : null
})
const idInvalid = computed(() => id.value === null)
const {
  data,
  isLoading,
  isError,
  isFetching,
  isFetchingNextPage,
  isFetchNextPageError,
  error,
  refetch,
  fetchNextPage,
  hasNextPage,
} = useNotificationDigest(id)
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/notifications', query: listQuery }
})
const items = computed(() => (data.value?.pages ?? []).flatMap(page => page.items))
const overdueCount = computed(() => data.value?.pages[0]?.overdue_count ?? items.value.length)
const queryErrorMessage = computed(() => (
  error.value instanceof ApiError ? error.value.message : t('notifications.loadError')
))

function openTask(taskId: number) {
  router.push(`/tasks/${taskId}`)
}

async function retryDigest() {
  if (isFetching.value) return
  await refetch()
}

async function retryNextPage() {
  if (isFetchingNextPage.value) return
  try {
    await fetchNextPage()
  } catch {
    // Keep already-loaded rows; isFetchNextPageError drives the retry control.
  }
}
</script>

<template>
  <SharedRecordPage
    data-testid="notification-digest"
    :title="t('tasks.digest.title')"
    :description="t('tasks.digest.count', { n: overdueCount }, overdueCount)"
    :back-to="backTo"
    :back-label="t('notifications.back')"
    :loading="isLoading && !idInvalid && !items.length"
  >
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || isLoading || isFetching" :label="t('notifications.retry')" @click="retryDigest" />
    </template>
    <div v-if="idInvalid" class="grid gap-3 py-8 text-center" role="alert" data-testid="digest-invalid">
      <p class="text-sm text-error">{{ t('tasks.digest.invalid') }}</p>
    </div>
    <div v-else-if="isError && !items.length" class="grid gap-3 py-8 text-center" role="alert" data-testid="digest-error">
      <p class="text-sm text-error">{{ queryErrorMessage }}</p>
      <UButton type="button" color="neutral" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" :label="t('notifications.retry')" @click="retryDigest" />
    </div>
    <p v-else-if="!items.length" class="py-8 text-center text-sm text-muted" data-testid="digest-empty">{{ t('tasks.digest.empty') }}</p>
    <div v-else class="overflow-hidden rounded-card bg-default ring ring-default">
      <ul class="divide-y divide-default">
        <li v-for="task in items" :key="task.id">
          <UButton
            type="button" color="neutral" variant="ghost"
            class="grid w-full gap-1 rounded-none p-3 text-start hover:bg-elevated"
            :disabled="!hydrated"
            :data-testid="`digest-task-${task.id}`"
            @click="openTask(task.id)"
          >
            <span class="font-medium">{{ task.name }}</span>
            <span class="text-sm text-muted">{{ task.project?.name }}</span>
          </UButton>
        </li>
      </ul>
      <div v-if="isFetchNextPageError" class="grid gap-2 border-t border-default p-4 text-center" role="alert" data-testid="digest-next-error">
        <p class="text-sm text-error">{{ t('tasks.digest.loadMoreError') }}</p>
        <UButton type="button" color="neutral" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-retry-page" :label="t('notifications.retry')" @click="retryNextPage" />
      </div>
      <div v-else-if="hasNextPage" class="border-t border-default p-4 text-center">
        <UButton color="neutral" variant="outline" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-load-more" :label="t('app.loadMore')" @click="retryNextPage" />
      </div>
    </div>
  </SharedRecordPage>
</template>
