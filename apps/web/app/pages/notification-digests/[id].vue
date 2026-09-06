<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@lucide/vue'
import { ApiError } from '@/composables/useApi'
import { useNotificationDigest } from '@/composables/useNotifications'
import { safeReturnTo } from '@/utils/safeReturnTo'

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
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/notifications', ['/notifications', '/notification-digests']))
const items = computed(() => (data.value?.pages ?? []).flatMap(page => page.items))
const overdueCount = computed(() => data.value?.pages[0]?.overdue_count ?? items.value.length)
const queryErrorMessage = computed(() => (
  error.value instanceof ApiError ? error.value.message : t('notifications.loadError')
))

function openTask(taskId: number) {
  router.push({ path: `/tasks/${taskId}`, query: { returnTo: route.fullPath } })
}

function goBack() {
  router.push(returnTo.value)
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
  <main data-testid="notification-digest" class="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-3xl flex-col gap-4">
    <nav class="flex items-center justify-between gap-3">
      <Button
        variant="ghost"
        size="sm"
        class="gap-2 px-2 text-muted-foreground"
        type="button"
        data-testid="digest-back"
        :disabled="!hydrated"
        :aria-label="t('notifications.back')"
        @click="goBack"
      >
        <component :is="isRtl ? ArrowRight : ArrowLeft" class="size-4" />
        {{ t('notifications.back') }}
      </Button>
      <Button type="button" variant="outline" size="sm" :disabled="!hydrated || isLoading || isFetching" @click="retryDigest">
        {{ t('notifications.retry') }}
      </Button>
    </nav>
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <header class="border-b px-5 py-4">
        <h1 class="text-2xl font-semibold">{{ t('tasks.digest.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('tasks.digest.count', { n: overdueCount }) }}</p>
      </header>
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="idInvalid" class="grid gap-3 py-8 text-center" role="alert" data-testid="digest-invalid">
          <p class="text-sm text-destructive">{{ t('tasks.digest.invalid') }}</p>
        </div>
        <div v-else-if="isError && !items.length" class="grid gap-3 py-8 text-center" role="alert" data-testid="digest-error">
          <p class="text-sm text-destructive">{{ queryErrorMessage }}</p>
          <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" @click="retryDigest">
            {{ t('notifications.retry') }}
          </Button>
        </div>
        <p v-else-if="isLoading" class="py-8 text-center text-sm text-muted-foreground">{{ t('notifications.loading') }}</p>
        <p v-else-if="!items.length" class="py-8 text-center text-sm text-muted-foreground" data-testid="digest-empty">{{ t('tasks.digest.empty') }}</p>
        <div v-else class="grid gap-2">
          <button
            v-for="task in items"
            :key="task.id"
            type="button"
            class="grid gap-1 rounded-lg border p-3 text-start hover:bg-muted"
            :disabled="!hydrated"
            :data-testid="`digest-task-${task.id}`"
            @click="openTask(task.id)"
          >
            <span class="font-medium">{{ task.name }}</span>
            <span class="text-sm text-muted-foreground">{{ task.project?.name }}</span>
          </button>
        </div>
      </div>
      <div v-if="isFetchNextPageError" class="grid gap-2 border-t p-4 text-center" role="alert" data-testid="digest-next-error">
        <p class="text-sm text-destructive">{{ t('tasks.digest.loadMoreError') }}</p>
        <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-retry-page" @click="retryNextPage">
          {{ t('notifications.retry') }}
        </Button>
      </div>
      <div v-else-if="hasNextPage" class="border-t p-4 text-center">
        <Button variant="outline" size="sm" :disabled="!hydrated || isFetchingNextPage" data-testid="digest-load-more" @click="retryNextPage">
          {{ t('app.loadMore') }}
        </Button>
      </div>
    </section>
  </main>
</template>
