<script setup lang="ts">
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'
import InboxChannelActions from '@/components/inbox/InboxChannelActions.vue'
import InboxChannelAlerts from '@/components/inbox/InboxChannelAlerts.vue'
import InboxChannelHealthCard from '@/components/inbox/InboxChannelHealthCard.vue'
import InboxChannelSending from '@/components/inbox/campaigns/InboxChannelSending.vue'
import InboxChannelTabs from '@/components/inbox/InboxChannelTabs.vue'
import InboxWebhookFields from '@/components/inbox/InboxWebhookFields.vue'
import { CHANNEL_STATE_TONE } from '@/composables/inbox/inboxPresentation'
import { useInboxCampaignsEnabled } from '@/composables/inbox/useInboxCampaigns'
import { useInboxChannel, useTestInboxChannel } from '@/composables/inbox/useInboxSettings'

// The health of one WhatsApp number as Meta last reported it: metrics, account state, the alert timeline, the webhook
// subscriptions to set up and the number administration actions. "Refresh now" asks Meta again.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const campaignsOn = useInboxCampaignsEnabled()
const query = useInboxChannel(id)
const channel = query.data
const { mutate: refresh, isPending: refreshing } = useTestInboxChannel(() => id.value ?? 0)
const backTo = '/settings/apps/inbox#channels'

const QUALITY_TAG_TONE = { green: 'success', yellow: 'warning', red: 'error', unknown: 'neutral' } as const
const tags = computed(() => {
  const value = channel.value
  if (!value) return []
  const { health } = value
  return [
    statusTag({ tone: CHANNEL_STATE_TONE[value.state], label: t(`inbox.channelStates.${value.state}`) }),
    { label: `${t('inbox.health.tiles.quality')}: ${t(`inbox.health.quality.${health.quality_rating}`)}`, tone: QUALITY_TAG_TONE[health.quality_rating], testId: 'inbox-health-quality-tag' },
    { label: `${t('inbox.health.tiles.limit')}: ${t(`inbox.health.limit.${health.messaging_limit}`)}`, kind: 'count' as const },
  ]
})
const checked = computed(() => channel.value?.health.checked_at ? t('inbox.health.checkedAt', { time: formatDateTime(channel.value.health.checked_at) }) : t('inbox.health.neverChecked'))
function runRefresh() {
  refresh(undefined, {
    onSuccess: () => toast.add({ title: t('inbox.health.refreshed'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordPage
    :title="channel?.name ?? t('inbox.health.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.settings.channels.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="channel" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="refreshing" :disabled="!hydrated || refreshing" :label="t('inbox.health.refresh')" data-testid="inbox-health-refresh" @click="runRefresh" />
    </template>

    <template v-if="channel && id">
      <InboxChannelTabs :channel-id="id" />
      <p class="text-sm text-muted" data-testid="inbox-health-checked">{{ checked }}</p>
      <UAlert v-if="channel.last_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.settings.channels.lastError')" :description="channel.last_error" data-testid="inbox-channel-error" />
      <InboxChannelHealthCard :health="channel.health" />
      <InboxChannelSending v-if="campaignsOn" :channel-id="id" can-edit />
      <InboxChannelAlerts :channel-id="id" />
      <InboxWebhookFields />
      <InboxChannelActions :channel="channel" />
    </template>
  </SharedRecordPage>
</template>
