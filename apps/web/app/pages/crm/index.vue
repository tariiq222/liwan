<script setup lang="ts">
import CrmDashboardAgentTable from '@/components/crm/dashboard/CrmDashboardAgentTable.vue'
import CrmDashboardConversion from '@/components/crm/dashboard/CrmDashboardConversion.vue'
import CrmDashboardDueList from '@/components/crm/dashboard/CrmDashboardDueList.vue'
import { useCrmDashboard } from '@/composables/crm/useCrmDashboard'
import { useCrmOpportunities } from '@/composables/crm/useOpportunities'
import { agentKpiTiles, managerKpiTiles } from '@/utils/crmDashboard'
import { CRM_LIST_PATH } from '@/utils/crmOpportunity'

// The CRM home. Everyone with `crm.leads.read` sees their own figures and the calls due now; the server adds the
// manager block (the whole team's figures, conversion by source and one row per agent) for those who manage.
const DUE_LIMIT = 5
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const dashboard = useCrmDashboard()
const due = useCrmOpportunities(() => ({ due: true, user_id: me.value?.id, limit: DUE_LIMIT, offset: 0 }), () => !!me.value)
const agentTiles = computed(() => (dashboard.data.value ? agentKpiTiles(dashboard.data.value.agent, t) : []))
const managerTiles = computed(() => (dashboard.data.value?.manager ? managerKpiTiles(dashboard.data.value.manager, t) : []))
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('crm.nav.dashboard')" kpi-toggle />
    <SharedForbiddenState v-if="!can('crm.leads.read')" />
    <SharedPageState v-else :loading="dashboard.isLoading.value" :error="dashboard.data.value ? null : dashboard.error.value" :empty="!dashboard.data.value" @retry="dashboard.refetch()">
      <template v-if="dashboard.data.value">
        <SharedKpiStrip :tiles="agentTiles" :label="t('crm.dashboard.agent.title')" data-testid="crm-agent-kpis" />
        <CrmDashboardDueList :items="due.data.value?.items ?? []" :total="due.data.value?.total ?? 0" :view-all-to="`${CRM_LIST_PATH}?due=1`" />
        <template v-if="dashboard.data.value.manager">
          <h2 class="text-base font-semibold text-highlighted">{{ t('crm.dashboard.manager.title') }}</h2>
          <SharedKpiStrip :tiles="managerTiles" :label="t('crm.dashboard.manager.title')" data-testid="crm-manager-kpis" />
          <div class="grid min-w-0 items-start gap-(--webvue-gap-card) lg:grid-cols-2">
            <CrmDashboardConversion :sources="dashboard.data.value.manager.conversion_by_source" />
            <CrmDashboardAgentTable :agents="dashboard.data.value.manager.agents" />
          </div>
        </template>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
