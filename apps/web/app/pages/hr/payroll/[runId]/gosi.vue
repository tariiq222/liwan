<script setup lang="ts">
import GosiStatementTable from '@/components/hr/payroll/GosiStatementTable.vue'
import { ApiError } from '@/composables/useApi'
import { formatPayrollMonth } from '@/utils/payrollFormat'
import { recordParentTo } from '@/utils/recordListOrigin'
import { parsePositiveId } from '@/utils/routeParams'

// The GOSI statement of one fixed run, printable: the run page is its parent, and a run that is not approved yet
// answers 403, which the page state shows.
const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const sourcePaths = useRecordListPaths(['/hr/payroll'])
const runId = computed(() => parsePositiveId(route.params.runId))
const query = useHrGosiStatement(runId)
const statement = computed(() => query.data.value)
// A draft or computed run answers 403 transition_forbidden: that is "not approved yet", not a missing permission.
const notApproved = computed(() => query.error.value instanceof ApiError && query.error.value.code === 'transition_forbidden')
const pageError = computed(() => (notApproved.value ? null : query.error.value) ?? (runId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => recordParentTo(`/hr/payroll/${runId.value ?? ''}`, route.query, sourcePaths.value, route.hash))
const title = computed(() => statement.value
  ? t('hrPayroll.gosiStatement.pageTitle', { month: formatPayrollMonth(statement.value.month, locale.value) })
  : t('hrPayroll.gosiStatement.title'))

function printPage() {
  if (hydrated.value && import.meta.client) window.print()
}
</script>

<template>
  <SharedRecordPage width="full" :keep-content="!!statement || notApproved" :title="title" :back-to="backTo" :loading="query.isLoading.value" :error="pageError" @retry="query.refetch">
    <template v-if="statement" #actions>
      <UButton class="liwan-print-hide" color="neutral" variant="outline" icon="i-lucide-printer" :disabled="!hydrated" :label="t('hrPayroll.gosiStatement.print')" data-testid="hr-payroll-gosi-print" @click="printPage" />
    </template>
    <SharedEmptyState v-if="notApproved" bordered :title="t('hrPayroll.gosiStatement.notApprovedTitle')" :description="t('hrPayroll.gosiStatement.notApprovedHint')" data-testid="hr-payroll-gosi-not-approved">
      <template #action>
        <UButton color="neutral" variant="outline" :to="backTo" :label="t('hrPayroll.gosiStatement.backToRun')" data-testid="hr-payroll-gosi-back" />
      </template>
    </SharedEmptyState>
    <SharedEmptyState v-else-if="statement && statement.lines.length === 0" compact :title="t('hrPayroll.gosiStatement.emptyTitle')" :description="t('hrPayroll.gosiStatement.emptyHint')" />
    <GosiStatementTable v-else-if="statement" :statement="statement" :caption="title" />
  </SharedRecordPage>
</template>
