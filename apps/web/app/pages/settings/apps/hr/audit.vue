<script setup lang="ts">
import PayrollAuditList from '@/components/hr/payroll/PayrollAuditList.vue'
import { payrollAuditFiltersFromQuery, payrollAuditParams } from '@/components/hr/payroll/payrollAuditParams'
import { useHrPayrollAuditEvents } from '@/composables/useHrPayrollAudit'
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('hr.payroll.audit.read'))
const query = useHrPayrollAuditEvents(() => payrollAuditParams(payrollAuditFiltersFromQuery(route.query)), allowed)
const tags = computed<PageHeaderTag[]>(() => query.data.value
  ? [{ label: t('hrPayroll.audit.countTag', { count: query.data.value.total }, query.data.value.total), kind: 'count', testId: 'hr-payroll-audit-total' }]
  : [])
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('hrPayroll.audit.title')" :tags="tags" />
    <PayrollAuditList />
  </SharedSettingsPage>
</template>
