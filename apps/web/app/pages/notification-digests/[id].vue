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
    :back-to="backTo"
    :back-label="t('notifications.back')"
    :loading="isLoading && !idInvalid && !items.length"
  >
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || isLoading || isFetching" :label="t('notifications.retry')" @click="retryDigest" />
    </template>
    <SharedEmptyState v-if="idInvalid" bordered :title="t('tasks.digest.invalid')" data-testid="digest-invalid" />
    <SharedErrorState v-else-if="isError && !items.length" :title="queryErrorMessage" data-testid="digest-error" @retry="retryDigest" />
    <SharedEmptyState v-else-if="!items.length" bordered :title="t('tasks.digest.empty')" data-testid="digest-empty" />
    <SharedListCard v-else>
      <ul class="divide-y divide-default">
        <li v-for="task in items" :key="task.id">
          <UButton
            type="button" color="neutral" variant="ghost"
            class="grid w-full gap-1 rounded-none px-(--webvue-card-pad-dense) py-3 text-start hover:bg-elevated"
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
      <template #footer>
        <span class="tabular-nums">{{ t('tasks.digest.count', { n: items.length }, items.length) }}</span>
        <UButton v-if="hasNextPage && !isFetchNextPageError" color="neutral" variant="outline" size="sm" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-load-more" :label="t('app.loadMore')" @click="retryNextPage" />
      </template>
    </SharedListCard>
  </SharedRecordPage>
</template>
