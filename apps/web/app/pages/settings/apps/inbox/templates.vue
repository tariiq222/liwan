<script setup lang="ts">
import InboxChannelPicker from '@/components/inbox/InboxChannelPicker.vue'

// The templates of the company: opens the one WhatsApp channel's templates, or lists the channels to pick from.
const { t } = useI18n()
</script>

<template>
  <SharedRecordPage :title="t('inbox.templates.title')" back-to="/settings/apps/inbox" :back-label="t('inbox.title')">
    <InboxChannelPicker section="templates" />
  </SharedRecordPage>
</template>
