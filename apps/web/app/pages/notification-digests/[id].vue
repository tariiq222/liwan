<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useNotificationDigest } from '@/composables/useNotifications'

const route = useRoute()
const router = useRouter()
const { t, localeProperties } = useI18n()
const hydrated = useHydrated()
const isRtl = computed(() => localeProperties.value.dir === 'rtl')
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

function goBack() {
  router.push(backTo.value)
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
  <SharedPageContainer data-testid="notification-digest" width="detail" class="flex min-h-[calc(100vh-7rem)] flex-col">
    <SharedPageHeader :title="t('tasks.digest.title')" :description="t('tasks.digest.count', { n: overdueCount })">
      <template #back>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          class="gap-2 px-2 text-muted-foreground"
          type="button"
          data-testid="digest-back"
          :disabled="!hydrated"
          :aria-label="t('notifications.back')"
          @click="goBack"
          :label="t('notifications.back')"
        >
          <UIcon :name="isRtl ? 'i-lucide-arrow-right' : 'i-lucide-arrow-left'" class="size-[18px]" aria-hidden="true" />
          {{ t('notifications.back') }}
        </UButton>
      </template>
      <template #actions>
        <UButton type="button" color="secondary" variant="outline" size="sm" :disabled="!hydrated || isLoading || isFetching" :label="t('notifications.retry')" @click="retryDigest" />
      </template>
    </SharedPageHeader>
    <UCard class="overflow-hidden">
      <div class="max-h-[calc(100vh-14rem)] overflow-y-auto p-4">
        <div v-if="idInvalid" class="grid gap-3 py-8 text-center" role="alert" data-testid="digest-invalid">
          <p class="text-sm text-destructive">{{ t('tasks.digest.invalid') }}</p>
        </div>
        <div v-else-if="isError && !items.length" class="grid gap-3 py-8 text-center" role="alert" data-testid="digest-error">
          <p class="text-sm text-destructive">{{ queryErrorMessage }}</p>
          <UButton type="button" color="secondary" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" :label="t('notifications.retry')" @click="retryDigest" />
        </div>
        <p v-else-if="isLoading" class="py-8 text-center text-sm text-muted-foreground">{{ t('notifications.loading') }}</p>
        <p v-else-if="!items.length" class="py-8 text-center text-sm text-muted-foreground" data-testid="digest-empty">{{ t('tasks.digest.empty') }}</p>
        <div v-else class="grid gap-2">
          <UButton
            v-for="task in items"
            :key="task.id"
            type="button"
            color="neutral"
            variant="ghost"
            class="grid w-full gap-1 rounded-lg border p-3 text-start hover:bg-muted"
            :disabled="!hydrated"
            :data-testid="`digest-task-${task.id}`"
            @click="openTask(task.id)"
          >
            <span class="font-medium">{{ task.name }}</span>
            <span class="text-sm text-muted-foreground">{{ task.project?.name }}</span>
          </UButton>
        </div>
      </div>
      <div v-if="isFetchNextPageError" class="grid gap-2 border-t p-4 text-center" role="alert" data-testid="digest-next-error">
        <p class="text-sm text-destructive">{{ t('tasks.digest.loadMoreError') }}</p>
        <UButton type="button" color="secondary" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-retry-page" :label="t('notifications.retry')" @click="retryNextPage" />
      </div>
      <div v-else-if="hasNextPage" class="border-t p-4 text-center">
        <UButton color="secondary" variant="outline" size="sm" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-load-more" :label="t('app.loadMore')" @click="retryNextPage" />
      </div>
    </UCard>
  </SharedPageContainer>
</template>
