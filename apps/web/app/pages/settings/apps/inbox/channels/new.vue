<script setup lang="ts">
import type { InboxChannelKind } from '@liwan/contracts'
import InboxChannelForm from '@/components/inbox/InboxChannelForm.vue'
import { useInboxWhatsAppEnabled } from '@/composables/inbox/inboxFeatures'
import { useInboxTikTokEnabled } from '@/composables/inbox/inboxTikTok'

// Add a channel: the route-backed create panel over the inbox settings page. The account a channel runs on is connected
// at /settings/integrations; the form picks one of the company's connected accounts.
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/settings/apps/inbox#channels'
const whatsappOn = useInboxWhatsAppEnabled()
const tiktokOn = useInboxTikTokEnabled()
const kinds = computed<InboxChannelKind[]>(() => [...(whatsappOn.value ? ['whatsapp' as const] : []), ...(tiktokOn.value ? ['tiktok' as const] : [])])
const allowed = computed(() => can('inbox.channels.manage') && kinds.value.length > 0)
</script>

<template>
  <SharedCreatePanel :title="t('inbox.settings.channels.connect')" :description="t('inbox.settings.channels.connectHint')" :back-to="backTo">
    <InboxChannelForm
      v-if="allowed"
      :back-to="backTo"
      :kinds="kinds"
      @saved="channel => navigateTo(`/settings/apps/inbox/channels/${channel.id}`, { replace: true })"
    />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
