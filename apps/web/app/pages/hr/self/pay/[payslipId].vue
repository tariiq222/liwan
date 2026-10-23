<script setup lang="ts">
definePageMeta({ path: '/account/pay/:payslipId' })
import PayslipDocument from '@/components/hr/payroll/PayslipDocument.vue'
import { ApiError } from '@/composables/useApi'
import { formatPayrollMonth } from '@/utils/payrollFormat'
import { owningListBack } from '@/utils/recordListOrigin'
import { parsePositiveId } from '@/utils/routeParams'

// One of the caller's own approved payslips, as the same printable document the payroll area shows.
const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const sourcePaths = useRecordListPaths(['/account/pay'])
const payslipId = computed(() => parsePositiveId(route.params.payslipId))
const query = useMyHrPayslip(payslipId)
const payslip = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (payslipId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

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
      <UButton color="neutral" variant="outline" :to="backTo" :label="t('app.back')" data-testid="hr-my-payslip-back" />
      <UButton type="button" icon="i-lucide-printer" :disabled="!hydrated || !payslip" :label="t('hrPayroll.actions.printPayslip')" data-testid="hr-payslip-print" @click="printPage" />
    </template>
  </SharedStandalonePage>
</template>
