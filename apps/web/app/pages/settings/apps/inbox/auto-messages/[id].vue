<script setup lang="ts">
import InboxChannelAutomationForm from '@/components/inbox/InboxChannelAutomationForm.vue'
import { useInboxAutomationChannels, useInboxChannelAutomation } from '@/composables/inbox/useInboxAutomation'

// The automatic messages of one channel: welcome, away and the satisfaction survey.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const channels = useInboxAutomationChannels()
const channelName = computed(() => channels.data.value?.items.find(item => item.id === id.value)?.name ?? '')
const automation = useInboxChannelAutomation(id)
</script>

<template>
  <SharedRecordPage
    :title="t('inbox.automation.channelTitle', { name: channelName })"
    :back-to="'/settings/apps/inbox#auto-messages'"
    :back-label="t('inbox.title')"
    :loading="id !== null && (channels.isPending.value || automation.isPending.value)"
    :error="id === null ? { status: 404 } : channels.error.value ?? automation.error.value"
    @retry="hydrated && (channels.refetch(), automation.refetch())"
  >
    <SharedForbiddenState v-if="id && !can('inbox.automation.manage')" />
    <InboxChannelAutomationForm v-else-if="id && automation.data.value" :channel-id="id" :automation="automation.data.value" />
  </SharedRecordPage>
</template>
