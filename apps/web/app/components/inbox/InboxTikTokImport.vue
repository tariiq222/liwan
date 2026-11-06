<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import type { InboxTikTokSync } from '@liwan/contracts'
import { inboxTikTokErrorKey, useInboxTikTokSync, useStartInboxTikTokSync } from '@/composables/inbox/inboxTikTok'

// The channel's history import (D11): the last 90 days of conversations, the newest messages of each, imported by a
// cron one step at a time. The page shows the latest job; the button queues another one, which the server refuses
// while one is still running (`inbox_tiktok_sync_running`).
const props = defineProps<{ channelId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const query = useInboxTikTokSync(() => props.channelId)
const { mutate: start, isPending: starting } = useStartInboxTikTokSync(() => props.channelId)
const job = computed<InboxTikTokSync | null>(() => query.data.value?.job ?? null)
const JOB_TONE: Record<InboxTikTokSync['state'], StatusTone> = { queued: 'info', running: 'info', done: 'success', failed: 'destructive' }
const active = computed(() => job.value?.state === 'queued' || job.value?.state === 'running')
const off = computed(() => !hydrated.value || starting.value || active.value)
const rows = computed(() => {
  const value = job.value
  if (!value) return []
  return [
    { label: t('inbox.tiktok.import.phase.label'), value: t(`inbox.tiktok.import.phase.${value.phase}`) },
    { label: t('inbox.tiktok.import.conversations'), value: String(value.conversations_count) },
    { label: t('inbox.tiktok.import.messages'), value: String(value.messages_count) },
    { label: t('inbox.tiktok.import.startedAt'), value: value.started_at ? formatDateTime(value.started_at) : t('inbox.tiktok.import.notStarted') },
    { label: t('inbox.tiktok.import.finishedAt'), value: value.finished_at ? formatDateTime(value.finished_at) : t('inbox.tiktok.import.notFinished') },
  ]
})

function fail(e: unknown) {
  const key = inboxTikTokErrorKey(e)
  toast.add({ title: key ? t(key) : e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
}
function runImport() {
  start(undefined, {
    onSuccess: () => toast.add({ title: t('inbox.tiktok.import.queued'), color: 'success' }),
    onError: fail,
  })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.tiktok.import.title')" :description="t('inbox.tiktok.import.hint')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="!hydrated" :label="t('inbox.tiktok.import.refresh')" @click="query.refetch()" />
      <UButton type="button" icon="i-lucide-cloud-download" :disabled="off" :loading="starting" :label="t('inbox.tiktok.import.action')" data-testid="inbox-tiktok-import-start" @click="runImport" />
    </template>
    <div class="flex flex-col gap-3" data-testid="inbox-tiktok-import">
      <SharedLoadingSkeleton v-if="!hydrated || query.isPending.value" />
      <SharedErrorState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
      <p v-else-if="!job" class="text-sm text-muted" data-testid="inbox-tiktok-import-none">{{ t('inbox.tiktok.import.none') }}</p>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <SharedStatusBadge :tone="JOB_TONE[job.state]" :label="t(`inbox.tiktok.import.state.${job.state}`)" data-testid="inbox-tiktok-import-state" />
          <span v-if="active" class="text-xs text-muted" role="status">{{ t('inbox.tiktok.import.runningHint') }}</span>
        </div>
        <UAlert v-if="job.error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.tiktok.import.failed')" :description="job.error" data-testid="inbox-tiktok-import-error" />
        <dl class="liwan-auto-grid">
          <div v-for="row in rows" :key="row.label">
            <dt class="text-xs text-muted">{{ row.label }}</dt>
            <dd class="text-sm font-medium text-highlighted">{{ row.value }}</dd>
          </div>
        </dl>
      </template>
    </div>
  </SharedRecordSection>
</template>
