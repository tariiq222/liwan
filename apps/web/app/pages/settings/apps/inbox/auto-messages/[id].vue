<script setup lang="ts">
import InboxChannelAutomationForm from '@/components/inbox/InboxChannelAutomationForm.vue'
import { useInboxChannelAutomation } from '@/composables/inbox/useInboxAutomation'
import { useInboxChannel } from '@/composables/inbox/useInboxSettings'

// The automatic messages of one channel: welcome, away and the satisfaction survey.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const channel = useInboxChannel(id)
const automation = useInboxChannelAutomation(id)
</script>

<template>
  <SharedRecordPage
    :title="t('inbox.automation.channelTitle', { name: channel.data.value?.name ?? '' })"
    :back-to="'/settings/apps/inbox#auto-messages'"
    :back-label="t('inbox.title')"
    :loading="id !== null && (channel.isPending.value || automation.isPending.value)"
    :error="id === null ? { status: 404 } : channel.error.value ?? automation.error.value"
    @retry="hydrated && (channel.refetch(), automation.refetch())"
  >
    <SharedForbiddenState v-if="id && !can('inbox.automation.manage')" />
    <InboxChannelAutomationForm v-else-if="id && automation.data.value" :channel-id="id" :automation="automation.data.value" />
  </SharedRecordPage>
</template>
