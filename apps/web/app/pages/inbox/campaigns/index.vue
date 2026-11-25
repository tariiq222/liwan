<script setup lang="ts">
import InboxCampaignList from '@/components/inbox/campaigns/InboxCampaignList.vue'
import { parseCampaignListRoute } from '@/composables/inbox/inboxCampaignRoute'
import { useInboxCampaignKpis } from '@/composables/inbox/useInboxKpis'

// The campaigns list. Creating a campaign is the route-backed panel at /inbox/campaigns/new over this page.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const createTo = computed(() => ({ path: '/inbox/campaigns/new', query: route.query }))
// The summary strip counts the whole list under the search and the channel; each tile adds its own state.
const { shown: kpisShown } = useKpiVisibility()
const filters = computed(() => parseCampaignListRoute(route.query))
const kpis = useInboxCampaignKpis(
  () => ({ q: filters.value.q, channelId: filters.value.channelId }),
  computed(() => hydrated.value && kpisShown.value),
)
</script>

<template>
  <SharedListPage :title="t('inbox.campaigns.title')" :create-to="createTo" :create-label="t('inbox.campaigns.new')" create-test-id="inbox-campaign-new" data-testid="inbox-campaigns-page">
    <template #kpis>
      <SharedKpiStrip v-if="hydrated && kpisShown" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('inbox.campaigns.kpi.label')" data-testid="inbox-campaigns-kpi-strip" />
    </template>
    <template #actions>
      <UButton to="/inbox/campaigns/audiences" color="neutral" variant="outline" icon="i-lucide-users-round" :label="t('inbox.campaigns.audiences.title')" data-testid="inbox-campaign-audiences-link" />
    </template>
    <InboxCampaignList />
  </SharedListPage>
</template>
