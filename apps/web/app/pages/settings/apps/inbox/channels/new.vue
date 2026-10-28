<script setup lang="ts">
import InboxChannelForm from '@/components/inbox/InboxChannelForm.vue'

// Connect a channel: the route-backed create panel over the inbox settings page.
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/settings/apps/inbox#channels'
</script>

<template>
  <SharedCreatePanel :title="t('inbox.settings.channels.connect')" :description="t('inbox.settings.channels.connectHint')" :back-to="backTo">
    <InboxChannelForm v-if="can('inbox.channels.manage')" :back-to="backTo" @saved="channel => navigateTo({ path: `/settings/apps/inbox/channels/${channel.id}`, hash: '#webhook' }, { replace: true })" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
