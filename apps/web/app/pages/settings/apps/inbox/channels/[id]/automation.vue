<script setup lang="ts">
import InboxChannelAutomationForm from '@/components/inbox/InboxChannelAutomationForm.vue'
import InboxChannelTabs from '@/components/inbox/InboxChannelTabs.vue'
import { useInboxChannelAutomation } from '@/composables/inbox/useInboxAutomation'
import { useInboxChannel } from '@/composables/inbox/useInboxSettings'

// A TikTok channel's automatic messages: its welcome (which TikTok sends itself), its away message and its
// satisfaction survey, edited with TikTok's limits. The page exists for TikTok only; a WhatsApp channel edits the
// same form from the automatic-messages page of the automation area.
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
const automation = useInboxChannelAutomation(id)
</script>

<template>
  <SharedRecordPage
    :title="channel?.name ?? t('inbox.channelTabs.automation')"
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
      <template v-else>
        <SharedLoadingSkeleton v-if="!hydrated || automation.isPending.value" />
        <SharedErrorState v-else-if="automation.error.value" :error="automation.error.value" @retry="automation.refetch()" />
        <InboxChannelAutomationForm v-else-if="automation.data.value" :channel-id="id" kind="tiktok" :automation="automation.data.value" />
      </template>
    </template>
  </SharedRecordPage>
</template>
