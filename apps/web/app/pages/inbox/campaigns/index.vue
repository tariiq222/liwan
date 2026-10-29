<script setup lang="ts">
import InboxCampaignList from '@/components/inbox/campaigns/InboxCampaignList.vue'

// The campaigns list. Creating a campaign is the route-backed panel at /inbox/campaigns/new over this page.
const route = useRoute()
const { t } = useI18n()
const createTo = computed(() => ({ path: '/inbox/campaigns/new', query: route.query }))
</script>

<template>
  <SharedListPage :title="t('inbox.campaigns.title')" :create-to="createTo" :create-label="t('inbox.campaigns.new')" create-test-id="inbox-campaign-new" data-testid="inbox-campaigns-page">
    <template #actions>
      <UButton to="/inbox/campaigns/audiences" color="neutral" variant="outline" icon="i-lucide-users-round" :label="t('inbox.campaigns.audiences.title')" data-testid="inbox-campaign-audiences-link" />
    </template>
    <InboxCampaignList />
  </SharedListPage>
</template>
