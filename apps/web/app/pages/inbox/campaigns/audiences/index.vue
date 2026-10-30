<script setup lang="ts">
import InboxAudienceList from '@/components/inbox/campaigns/InboxAudienceList.vue'

// The audiences list and the contact import. Creating an audience is the route-backed panel at /new over this page.
const route = useRoute()
const { t } = useI18n()
const createTo = computed(() => ({ path: '/inbox/campaigns/audiences/new', query: route.query }))
</script>

<template>
  <SharedListPage
    :title="t('inbox.campaigns.audiences.title')" back-to="/inbox/campaigns" :back-label="t('inbox.campaigns.title')"
    :create-to="createTo" :create-label="t('inbox.campaigns.audiences.new')" create-test-id="inbox-audience-new" data-testid="inbox-audiences-page"
  >
    <InboxAudienceList />
  </SharedListPage>
</template>
