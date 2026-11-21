<script setup lang="ts">
import CommunicationSenderForm from '@/components/settings/CommunicationSenderForm.vue'

// The create panel over the communications page: add a sender (a number, a sender name or a messaging service) to a
// messaging account. Adding needs integrations.manage; a direct link without it shows why instead of a form.
const BACK_TO = '/settings/integrations/communications'
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('integrations.manage'))
</script>

<template>
  <SharedCreatePanel :title="t('integrations.communications.senderForm.title')" :back-to="BACK_TO">
    <SharedForbiddenState v-if="forbidden" :description="t('integrations.errors.forbidden')" />
    <CommunicationSenderForm v-else :back-to="BACK_TO" @created="navigateTo(BACK_TO, { replace: true })" />
  </SharedCreatePanel>
</template>
