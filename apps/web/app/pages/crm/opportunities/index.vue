<script setup lang="ts">
import CrmOpportunityList from '@/components/crm/opportunity/CrmOpportunityList.vue'
import { CRM_AUDIT_PATH, useCrmAuditAccess } from '@/composables/crm/useCrmAudit'
import { useCrmExport } from '@/composables/crm/useCrmExport'
import { useCrmOpportunityKpis } from '@/composables/crm/useCrmOpportunityKpis'
import { useOpportunityListPage } from '@/composables/crm/useOpportunityListPage'
import { hasFeature } from '@/modules/registry'
import { opportunityFilters } from '@/utils/crmOpportunity'
import { exportTooLargeMessage } from '@/utils/exportErrors'

const page = useOpportunityListPage()
const { t, n } = useI18n()
const route = useRoute()
const { can } = useAccess()
const { me } = useMe()
const toast = useToast()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const canRead = computed(() => can('crm.leads.read'))
const canExport = computed(() => can('crm.leads.export') && hasFeature(me.value, 'crm.export'))
const canViewAudit = useCrmAuditAccess()
const exportCsv = useCrmExport()
const listTotal = ref<number | undefined>(undefined)
const listFilters = computed(() => opportunityFilters(route.query))
const activeView = computed(() => (typeof route.query.view === 'string' && route.query.view ? route.query.view : undefined))
const kpis = useCrmOpportunityKpis(listFilters, listTotal, computed(() => kpisShown.value && canRead.value), activeView)
function downloadCsv() {
  // The snapshot of the address is what the list shows now; the download reads nothing else.
  exportCsv.mutate({ ...route.query }, { onError: error => toast.add({ title: exportTooLargeMessage(error, t, n) ?? t('crm.opportunities.list.exportFailed'), color: 'error' }) })
}
</script>

<template>
  <SharedListPage v-bind="page">
    <template v-if="canRead" #kpis>
      <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('crm.opportunities.kpi.label')" data-testid="crm-opportunity-kpi-strip" />
    </template>
    <template #actions>
      <UButton v-if="canViewAudit" variant="ghost" icon="i-lucide-history" :to="CRM_AUDIT_PATH" data-testid="crm-audit-link">{{ t('crm.opportunities.list.auditLink') }}</UButton>
      <UButton
        v-if="canExport"
        variant="outline"
        icon="i-lucide-download"
        :loading="exportCsv.isPending.value"
        :disabled="!hydrated || exportCsv.isPending.value"
        data-testid="crm-export-csv"
        @click="downloadCsv"
      >{{ t(exportCsv.isPending.value ? 'crm.opportunities.list.exporting' : 'crm.opportunities.list.export') }}</UButton>
    </template>
    <template #default="{ view }">
      <CrmOpportunityList :view="view" :create-to="page.createTo" @update:total="listTotal = $event" />
    </template>
  </SharedListPage>
</template>
