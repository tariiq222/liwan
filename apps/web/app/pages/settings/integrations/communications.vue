<script setup lang="ts">
import CommunicationLimitCard from '@/components/settings/CommunicationLimitCard.vue'
import CommunicationLogCard from '@/components/settings/CommunicationLogCard.vue'
import CommunicationLookupCard from '@/components/settings/CommunicationLookupCard.vue'
import CommunicationSendersCard from '@/components/settings/CommunicationSendersCard.vue'
import CommunicationTestCard from '@/components/settings/CommunicationTestCard.vue'
import CommunicationVoiceTestCard from '@/components/settings/CommunicationVoiceTestCard.vue'
import CommunicationCallLogCard from '@/components/settings/CommunicationCallLogCard.vue'

// Communications: the senders of the company's communication accounts (messages and voice), its daily message and
// call limits and recording switch, a test send and a test call, the message log and the call log, and a number
// lookup. The page is provider-neutral (senders and logs belong to the company, not to one provider). Reading needs
// integrations.read; changes and the tests need integrations.manage; the logs need integrations.log.read, a
// capability no built-in role carries, so their cards are not drawn without it. The sender create panel is its child
// route.
const { t } = useI18n()
const { can } = useAccess()
const canRead = computed(() => can('integrations.read'))
const canManage = computed(() => can('integrations.manage'))
const canReadLog = computed(() => can('integrations.log.read'))
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('integrations.communications.title')" :description="t('integrations.communications.hint')" back-to="/settings/integrations" :back-label="t('integrations.record.back')" />
    <SharedForbiddenState v-if="!canRead" :description="t('integrations.errors.forbidden')" />
    <template v-else>
      <CommunicationSendersCard :can-manage="canManage" />
      <CommunicationLimitCard :can-manage="canManage" />
      <CommunicationTestCard v-if="canManage" :can-manage="canManage" :can-retry="canManage && canReadLog" />
      <CommunicationVoiceTestCard v-if="canManage" :can-manage="canManage" />
      <CommunicationLookupCard v-if="canManage" :can-manage="canManage" />
      <CommunicationLogCard v-if="canReadLog" :can-retry="canManage" />
      <CommunicationCallLogCard v-if="canReadLog" />
    </template>
  </SharedSettingsPage>
  <NuxtPage />
</template>
