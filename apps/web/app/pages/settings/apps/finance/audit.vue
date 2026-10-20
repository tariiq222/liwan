<script setup lang="ts">
import AuditList from '@/components/finance/governance/AuditList.vue'
import { auditFiltersFromQuery, auditListParams } from '@/components/finance/governance/auditParams'
import { useFinanceAuditEvents } from '@/composables/finance/useFinanceAudit'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('finance.audit.read'))
const query = useFinanceAuditEvents(() => auditListParams(auditFiltersFromQuery(route.query)), allowed)
const tags = computed<PageHeaderTag[]>(() => query.data.value
  ? [{ label: t('financeGovernance.audit.countTag', { count: query.data.value.total }, query.data.value.total), kind: 'count', testId: 'finance-audit-total' }]
  : [])
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('financeGovernance.audit.title')" :description="t('financeGovernance.audit.description')" :tags="tags" />
    <AuditList />
  </SharedSettingsPage>
</template>
