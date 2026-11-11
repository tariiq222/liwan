<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useInboxChannelEvents, useRetryInboxEvent } from '@/composables/inbox/useInboxSettings'

// A delivery the worker could not apply after all its attempts. The good items of the same delivery are already
// stored; re-running applies only the missing ones, because a stored message is skipped by its provider id.
const props = defineProps<{ channelId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const query = useInboxChannelEvents(() => props.channelId)
const items = computed(() => query.data.value?.items ?? [])
const { mutate: retry, isPending, variables } = useRetryInboxEvent(() => props.channelId)
function run(eventId: number) {
  retry(eventId, {
    onSuccess: () => toast.add({ title: t('inbox.health.deliveries.retried'), color: 'success' }),
    onError: (error: unknown) => toast.add({ title: error instanceof Error ? error.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection
    variant="list"
    :title="t('inbox.health.deliveries.title')"
    :description="t('inbox.health.deliveries.description')"
    data-testid="inbox-health-deliveries"
  >
    <SharedPageState v-if="query.error.value" class="m-4" :error="query.error.value" @retry="query.refetch()" />
    <SharedLoadingSkeleton v-else-if="query.isPending.value" class="m-4" />
    <p v-else-if="!items.length" class="px-(--liwan-card-pad) py-4 text-sm text-muted" data-testid="inbox-health-deliveries-empty">
      {{ t('inbox.health.deliveries.empty') }}
    </p>
    <ol v-else :aria-label="t('inbox.health.deliveries.caption')" class="divide-y divide-default">
      <li v-for="event in items" :key="event.id" class="flex flex-wrap items-start justify-between gap-3 px-(--liwan-card-pad) py-3" :data-testid="`inbox-health-delivery-${event.id}`">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-highlighted">{{ t('inbox.health.deliveries.attempts', { count: event.attempts }) }}</span>
            <time class="text-xs text-muted" :datetime="event.created_at">{{ formatDateTime(event.created_at) }}</time>
          </div>
          <p v-if="event.error" class="break-words text-xs text-muted"><bdi dir="ltr">{{ event.error }}</bdi></p>
        </div>
        <UButton
          type="button"
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-rotate-ccw"
          :label="t('inbox.health.deliveries.retry')"
          :loading="isPending && variables === event.id"
          :disabled="!hydrated || isPending"
          :data-testid="`inbox-health-delivery-retry-${event.id}`"
          @click="run(event.id)"
        />
      </li>
    </ol>
  </SharedRecordSection>
</template>
