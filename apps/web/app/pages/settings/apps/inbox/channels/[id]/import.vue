<script setup lang="ts">
import InboxChannelTabs from '@/components/inbox/InboxChannelTabs.vue'
import InboxTikTokImport from '@/components/inbox/InboxTikTokImport.vue'
import { useInboxChannel } from '@/composables/inbox/useInboxSettings'

// A TikTok channel's history import (D11): the latest job state, its counters and the button that queues another one.
// The page exists for TikTok only: a WhatsApp channel's history comes through its own webhook.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = '/settings/apps/inbox#channels'
const channelQuery = useInboxChannel(id)
const channel = channelQuery.data
</script>

<template>
  <SharedRecordPage
    :title="channel?.name ?? t('inbox.channelTabs.import')"
    :back-to="backTo"
    :back-label="t('inbox.settings.channels.title')"
    :loading="id !== null && channelQuery.isPending.value"
    :error="id === null ? { status: 404 } : channelQuery.error.value"
    @retry="hydrated && channelQuery.refetch()"
  >
    <template v-if="channel && id">
      <InboxChannelTabs :channel-id="id" :kind="channel.kind" />
      <SharedNotFoundState
        v-if="channel.kind !== 'tiktok'"
        :back-to="`/settings/apps/inbox/channels/${id}`"
        :back-label="t('inbox.settings.channels.title')"
      />
      <InboxTikTokImport v-else :channel-id="id" />
    </template>
  </SharedRecordPage>
</template>
