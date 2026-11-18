<script setup lang="ts">
import InboxChannelPicker from '@/components/inbox/InboxChannelPicker.vue'

// The flows of the company: opens the one WhatsApp channel's flows, or lists the channels to pick from.
const { t } = useI18n()
</script>

<template>
  <SharedRecordPage :title="t('inbox.flows.title')" back-to="/settings/apps/inbox" :back-label="t('inbox.title')">
    <InboxChannelPicker section="flows" />
  </SharedRecordPage>
</template>
