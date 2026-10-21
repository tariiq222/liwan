<script setup lang="ts">
import PayslipDocument from '@/components/hr/payroll/PayslipDocument.vue'
import { ApiError } from '@/composables/useApi'
import { formatPayrollMonth } from '@/utils/payrollFormat'
import { recordParentTo } from '@/utils/recordListOrigin'
import { parsePositiveId } from '@/utils/routeParams'

// One payslip of a run, as a printable document: the shell chrome drops out on paper and the page is black on white.
const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const sourcePaths = useRecordListPaths(['/hr/payroll'])
const runId = computed(() => parsePositiveId(route.params.runId))
const payslipId = computed(() => parsePositiveId(route.params.payslipId))
const query = useHrPayslip(runId, payslipId)
const payslip = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (runId.value && payslipId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => recordParentTo(`/hr/payroll/${runId.value ?? ''}`, route.query, sourcePaths.value, route.hash))

usePageHeader(() => payslip.value
  ? t('hrPayroll.payslip.pageTitle', { name: payslip.value.employee.name, month: formatPayrollMonth(payslip.value.month, locale.value) })
  : t('hrPayroll.payslip.title'))
useEscapeBack(() => backTo.value)

function printPage() {
  if (hydrated.value && import.meta.client) window.print()
}
</script>

<template>
  <SharedStandalonePage variant="print">
    <h1 class="sr-only">{{ t('hrPayroll.payslip.title') }}</h1>
    <SharedPageState :loading="query.isLoading.value" :error="pageError" @retry="query.refetch">
      <PayslipDocument v-if="payslip" :payslip="payslip" />
    </SharedPageState>
    <template #footer>
      <UButton color="neutral" variant="outline" :to="backTo" :label="t('app.back')" data-testid="hr-payslip-back" />
      <UButton type="button" icon="i-lucide-printer" :disabled="!hydrated || !payslip" :label="t('hrPayroll.actions.printPayslip')" data-testid="hr-payslip-print" @click="printPage" />
    </template>
  </SharedStandalonePage>
</template>
