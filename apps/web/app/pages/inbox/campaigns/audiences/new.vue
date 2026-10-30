<script setup lang="ts">
import InboxAudienceForm from '@/components/inbox/campaigns/InboxAudienceForm.vue'
import InboxAudienceList from '@/components/inbox/campaigns/InboxAudienceList.vue'

// Create an audience: the route-backed create panel over the audiences list.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => ({ path: '/inbox/campaigns/audiences', query: route.query }))
</script>

<template>
  <SharedListPage :title="t('inbox.campaigns.audiences.title')" hide-header>
    <InboxAudienceList />
  </SharedListPage>
  <SharedCreatePanel :title="t('inbox.campaigns.audiences.new')" :description="t('inbox.campaigns.audiences.newHint')" :back-to="backTo">
    <InboxAudienceForm v-if="can('inbox.campaigns.manage')" back-to="/inbox/campaigns/audiences" @saved="navigateTo(`/inbox/campaigns/audiences/${$event.id}`, { replace: true })" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
