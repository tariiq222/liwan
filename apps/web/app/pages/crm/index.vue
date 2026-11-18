<script setup lang="ts">
import CrmDashboardAgentTable from '@/components/crm/dashboard/CrmDashboardAgentTable.vue'
import CrmDashboardConversion from '@/components/crm/dashboard/CrmDashboardConversion.vue'
import CrmDashboardDueList from '@/components/crm/dashboard/CrmDashboardDueList.vue'
import type { CrmCallDraft } from '@/components/crm/opportunity/CrmOpportunityCallForm.vue'
import { useCrmDashboard } from '@/composables/crm/useCrmDashboard'
import { useCrmLostReasonChoices, useCrmOutcomeChoices, useCrmPackageChoices } from '@/composables/crm/useCrmLists'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'
import { useCrmOpportunities, useCrmOpportunityActions } from '@/composables/crm/useOpportunities'
import { callRecordedText } from '@/utils/crmCallResult'
import { agentKpiTiles, managerKpiTiles } from '@/utils/crmDashboard'
import { crmErrorMessage } from '@/utils/crmErrors'
import { CRM_LIST_PATH, manualLostReasons } from '@/utils/crmOpportunity'

// The CRM home. Everyone with `crm.leads.read` sees their own figures and the calls due now; the server adds the
// manager block (the whole team's figures, conversion by source and one row per agent) for those who manage.
const DUE_LIMIT = 20
const { t, locale } = useI18n()
const { can } = useAccess()
const { term } = useCrmTerms()
const toast = useToast()
const hydrated = useHydrated()
const { me } = useMe()
const dashboard = useCrmDashboard()
const due = useCrmOpportunities(() => ({ due: true, user_id: me.value?.id, limit: DUE_LIMIT, offset: 0 }), () => !!me.value)
const outcomes = useCrmOutcomeChoices()
const packages = useCrmPackageChoices()
const lostReasons = useCrmLostReasonChoices()
const actions = useCrmOpportunityActions()
const canCreate = computed(() => can('crm.leads.work') || can('crm.leads.assign'))
const existing = useCrmOpportunities(() => ({ status: 'all', limit: 1, offset: 0 }), canCreate)
const showFirstOpportunity = computed(() => canCreate.value && existing.data.value?.total === 0)
// One call form is open in the due list at a time. A refusal the form cannot settle shows under that row, with a link to the record.
const openId = ref<number | null>(null)
const callDirty = ref(false)
const failure = ref('')
watch(openId, () => { failure.value = '' })

async function recordCall(id: number, draft: CrmCallDraft) {
  failure.value = ''
  try {
    const result = await actions.recordCall.mutateAsync({ id, body: draft })
    toast.add({ title: callRecordedText(result.opportunity, t, locale.value), color: 'success' })
    openId.value = null
  } catch (error) {
    failure.value = crmErrorMessage(error, t, { sale: draft.package_id !== undefined })
  }
}
const agentTiles = computed(() => (dashboard.data.value ? agentKpiTiles(dashboard.data.value.agent, t) : []))
const managerTiles = computed(() => (dashboard.data.value?.manager ? managerKpiTiles(dashboard.data.value.manager, t) : []))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('crm.nav.dashboard')" kpi-toggle>
      <template v-if="canCreate && can('crm.leads.read')" #actions>
        <UButton :to="{ path: `${CRM_LIST_PATH}/new`, query: { returnTo: '/crm' } }" icon="i-lucide-plus" data-shortcut-create aria-keyshortcuts="c" :disabled="!hydrated" data-testid="crm-dashboard-create">{{ t('crm.opportunities.list.new', { term: term('opportunity', 'one') }) }}</UButton>
      </template>
    </SharedPageHeader>
    <SharedUnsavedChanges :dirty="callDirty" />
    <SharedForbiddenState v-if="!can('crm.leads.read')" />
    <SharedPageState empty-icon="i-lucide-layout-dashboard" v-else :loading="dashboard.isLoading.value" :error="dashboard.data.value ? null : dashboard.error.value" :empty="!dashboard.data.value" @retry="dashboard.refetch()">
      <template v-if="dashboard.data.value">
        <UAlert v-if="showFirstOpportunity" color="info" variant="subtle" icon="i-lucide-target"
          :title="t('crm.dashboard.firstOpportunity.title')" :description="t('crm.dashboard.firstOpportunity.description')" data-testid="crm-first-opportunity">
          <template #actions>
            <UButton to="/crm/opportunities/new" size="sm" :label="t('crm.dashboard.firstOpportunity.action')" />
          </template>
        </UAlert>
        <SharedKpiStrip :tiles="agentTiles" :label="t('crm.dashboard.agent.title')" data-testid="crm-agent-kpis" />
        <CrmDashboardDueList
          v-model:open-id="openId"
          v-model:dirty="callDirty"
          :items="due.data.value?.items ?? []"
          :total="due.data.value?.total ?? 0"
          :view-all-to="`${CRM_LIST_PATH}?due=1`"
          :loading="due.isPending.value"
          :error="due.data.value ? null : due.error.value"
          :can-record="can('crm.leads.work')"
          :outcomes="outcomes.data.value?.items ?? []"
          :packages="packages.data.value?.items ?? []"
          :lost-reasons="manualLostReasons(lostReasons.data.value?.items ?? [])"
          :pending="actions.recordCall.isPending.value"
          :failure="failure"
          @retry="due.refetch()"
          @record="recordCall"
        />
        <template v-if="dashboard.data.value.manager">
          <h2 class="text-base font-semibold text-highlighted">{{ t('crm.dashboard.manager.title') }}</h2>
          <SharedKpiStrip :tiles="managerTiles" :label="t('crm.dashboard.manager.title')" data-testid="crm-manager-kpis" />
          <div class="grid min-w-0 items-start gap-(--liwan-gap-card) lg:grid-cols-2">
            <CrmDashboardConversion :sources="dashboard.data.value.manager.conversion_by_source" />
            <CrmDashboardAgentTable :agents="dashboard.data.value.manager.agents" />
          </div>
        </template>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
