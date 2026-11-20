<script setup lang="ts">
import CommunicationLimitCard from '@/components/settings/CommunicationLimitCard.vue'
import CommunicationLogCard from '@/components/settings/CommunicationLogCard.vue'
import CommunicationSendersCard from '@/components/settings/CommunicationSendersCard.vue'
import CommunicationTestCard from '@/components/settings/CommunicationTestCard.vue'

// Communications: the senders of the company's messaging accounts, its daily message limit, a test send and the message
// log. The page is provider-neutral (senders and logs belong to the company, not to one provider). Reading needs
// integrations.read; changes and the test need integrations.manage; the message log needs integrations.log.read, a
// capability no built-in role carries, so its card is not drawn without it. The sender create panel is its child route.
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
      <CommunicationLogCard v-if="canReadLog" :can-retry="canManage" />
    </template>
  </SharedSettingsPage>
  <NuxtPage />
</template>
