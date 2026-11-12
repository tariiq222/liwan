<script setup lang="ts">
import CrmOpportunityList from '@/components/crm/opportunity/CrmOpportunityList.vue'
import { CRM_AUDIT_PATH, useCrmAuditAccess } from '@/composables/crm/useCrmAudit'
import { useCrmExport } from '@/composables/crm/useCrmExport'
import { useOpportunityListPage } from '@/composables/crm/useOpportunityListPage'
import { hasFeature } from '@/modules/registry'

const page = useOpportunityListPage()
const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const { me } = useMe()
const toast = useToast()
const hydrated = useHydrated()
const canExport = computed(() => can('crm.leads.export') && hasFeature(me.value, 'crm.export'))
const canViewAudit = useCrmAuditAccess()
const exportCsv = useCrmExport()
function downloadCsv() {
  // The snapshot of the address is what the list shows now; the download reads nothing else.
  exportCsv.mutate({ ...route.query }, { onError: () => toast.add({ title: t('crm.opportunities.list.exportFailed'), color: 'error' }) })
}
</script>

<template>
  <SharedListPage v-bind="page">
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
      <CrmOpportunityList :view="view" :create-to="page.createTo" />
    </template>
  </SharedListPage>
</template>
