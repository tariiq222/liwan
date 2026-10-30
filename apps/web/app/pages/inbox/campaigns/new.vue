<script setup lang="ts">
import InboxCampaignForm from '@/components/inbox/campaigns/InboxCampaignForm.vue'
import InboxCampaignList from '@/components/inbox/campaigns/InboxCampaignList.vue'

// Create a campaign: the route-backed create panel over the campaigns list. The list filters stay in the address.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => ({ path: '/inbox/campaigns', query: route.query }))
</script>

<template>
  <SharedListPage :title="t('inbox.campaigns.title')" hide-header>
    <InboxCampaignList />
  </SharedListPage>
  <SharedCreatePanel :title="t('inbox.campaigns.new')" :description="t('inbox.campaigns.newHint')" :back-to="backTo">
    <InboxCampaignForm v-if="can('inbox.campaigns.manage')" back-to="/inbox/campaigns" @saved="navigateTo(`/inbox/campaigns/${$event.id}`, { replace: true })" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
