<script setup lang="ts">
import InboxBusinessProfileForm from '@/components/inbox/InboxBusinessProfileForm.vue'
import InboxChannelTabs from '@/components/inbox/InboxChannelTabs.vue'
import { useInboxBusinessProfile } from '@/composables/inbox/useInboxChannelHealth'
import { useInboxChannel } from '@/composables/inbox/useInboxSettings'

// The WhatsApp business profile of one channel, read from Meta each time the page opens (LiwanOS keeps no copy).
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const channelQuery = useInboxChannel(id)
const channel = channelQuery.data
const profile = useInboxBusinessProfile(id, hydrated)
const backTo = '/settings/apps/inbox#channels'
</script>

<template>
  <SharedRecordPage
    :title="channel?.name ?? t('inbox.profile.title')"
    :back-to="backTo"
    :back-label="t('inbox.settings.channels.title')"
    :loading="id !== null && channelQuery.isPending.value"
    :error="id === null ? { status: 404 } : channelQuery.error.value"
    @retry="hydrated && channelQuery.refetch()"
  >
    <template v-if="channel && id">
      <InboxChannelTabs :channel-id="id" />
      <SharedLoadingSkeleton v-if="!hydrated || profile.isPending.value" />
      <SharedErrorState v-else-if="profile.error.value" :error="profile.error.value" :title="profile.error.value instanceof Error && profile.error.value.message ? profile.error.value.message : t('inbox.profile.loadError')" data-testid="inbox-profile-error" @retry="profile.refetch()" />
      <InboxBusinessProfileForm v-else-if="profile.data.value" :channel-id="id" :channel-name="channel.name" :app-id="channel.app_id" :profile="profile.data.value" />
    </template>
  </SharedRecordPage>
</template>
