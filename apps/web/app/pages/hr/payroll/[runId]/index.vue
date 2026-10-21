<script setup lang="ts">
import PayrollFileActions from '@/components/hr/payroll/PayrollFileActions.vue'
import PayrollInputsTable from '@/components/hr/payroll/PayrollInputsTable.vue'
import PayrollPaymentForm from '@/components/hr/payroll/PayrollPaymentForm.vue'
import PayrollPostingPreview from '@/components/hr/payroll/PayrollPostingPreview.vue'
import PayrollRunActions from '@/components/hr/payroll/PayrollRunActions.vue'
import PayrollRunTotals from '@/components/hr/payroll/PayrollRunTotals.vue'
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { HR_PAYSLIP_PAGE_SIZE, fetchAllHrPayslips, hrPayslipsQuery } from '@/composables/useHrPayrollRuns'
import { hrPayrollFileUrl } from '@/composables/useHrPayrollFiles'
import { eosProvisionErrorMessage, payrollErrorMessage } from '@/utils/payrollErrors'
import { saveBlob } from '@/utils/saveBlob'
import { currentPayrollDate, formatPayrollMonth, payrollRunStateTone } from '@/utils/payrollFormat'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { parsePositiveId } from '@/utils/routeParams'
import type { HrPayrollPaymentCreate, HrPayslipInputsPatch, HrPayslipRow } from '@webvue/contracts'

const route = useRoute()
const router = useRouter()
const { t, te, locale } = useI18n()
const hydrated = useHydrated()

const LIMIT = HR_PAYSLIP_PAGE_SIZE
const sourcePaths = useRecordListPaths(['/hr/payroll'])
const runId = computed(() => parsePositiveId(route.params.runId))
const runQuery = useHrPayrollRun(runId)
const run = computed(() => runQuery.data.value)
const pageError = computed(() => runQuery.error.value ?? (runId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const search = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const offset = computed(() => {
  const parsed = Number(Array.isArray(route.query.offset) ? route.query.offset[0] : route.query.offset)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
})
const payslips = useHrPayrollRunPayslips(runId, computed(() => hrPayslipsQuery({ q: search.value, limit: LIMIT, offset: offset.value })))
const rows = computed(() => payslips.data.value?.items ?? [])
const total = computed(() => payslips.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const employeeNames = computed(() => new Map(rows.value.map(row => [row.employee.id, row.employee.name])))

const transitions = useHrPayrollRunTransition(() => runId.value ?? 0)
const patchInputs = usePatchHrPayslipInputs(() => runId.value ?? 0)
const { $api, $download } = useApi()
const { can } = useAccess()
const posting = usePostHrPayrollRun(() => runId.value ?? 0)
const payment = useRecordHrPayrollPayment(() => runId.value ?? 0)
const provision = usePostHrEosProvision()
const confirming = ref<'approve' | 'cancel' | 'post' | 'record_payment' | 'eos_provision' | null>(null)
const preview = useHrPayrollPostingPreview(() => runId.value ?? 0, computed(() => runId.value !== null && confirming.value === 'post'))
const paymentJournals = usePaymentJournals(() => confirming.value === 'record_payment')
const pendingAction = computed(() => {
  if (posting.isPending.value) return 'post'
  if (payment.isPending.value) return 'record_payment'
  if (provision.isPending.value) return 'eos_provision'
  return (['compute', 'approve', 'cancel'] as const).find(action => transitions[action].isPending.value) ?? null
})
const failure = ref<unknown>(null)
// The provision of the run's month, read only where the finance bridge answered for this run (its `finance` block exists).
const provisions = useHrEosProvisions(() => !!run.value?.finance)
const provisionEntry = computed(() => provisions.data.value?.items.find(item => item.month === run.value?.month)?.entry_name ?? '')
// A missing-IBAN refusal names employees the loaded page may not hold: their names are read once, after the refusal.
const refusedNames = ref<ReadonlyMap<number, string>>(new Map())
// The provision's own refusal is kept apart: its codes (`duplicate`, `invalid`) mean something else on the run.
const provisionFailure = ref<unknown>(null)
watch(failure, (now) => { if (now) provisionFailure.value = null })
const failureMessage = computed(() => provisionFailure.value ? eosProvisionErrorMessage(provisionFailure.value, t) : failure.value ? payrollErrorMessage(failure.value, t, new Map([...employeeNames.value, ...refusedNames.value])) : '')

// The salary files exist once the run's figures are fixed; the bank profile list is asked for only then.
const FILE_STATES = ['approved', 'posted', 'paid']
const showFiles = computed(() => can('hr.payroll.read') && !!run.value && FILE_STATES.includes(run.value.state))
const profiles = useHrBankProfiles(showFiles)
const downloading = ref<'bank' | 'wps' | null>(null)
async function downloadFile(file: { kind: 'bank' | 'wps'; profileId: number; valueDate?: string }) {
  if (!hydrated.value || downloading.value || runId.value === null) return
  failure.value = null
  downloading.value = file.kind
  try {
    const { blob, filename } = await $download(hrPayrollFileUrl(runId.value, file.kind, file))
    saveBlob(blob, filename ?? `${file.kind === 'bank' ? 'salaries' : 'wps'}-${run.value?.month ?? runId.value}.csv`)
  } catch (error) {
    await nameRefusedEmployees(error, runId.value)
    failure.value = error
  } finally { downloading.value = null }
}
// Only a missing-IBAN refusal names employees, and the payslip list is read only for those not already on the page.
async function nameRefusedEmployees(error: unknown, id: number) {
  const ids = error instanceof ApiError && error.code === 'missing_iban' && Array.isArray(error.details?.employee_ids) ? error.details.employee_ids : []
  if (ids.every(employeeId => employeeNames.value.has(employeeId))) return
  try {
    refusedNames.value = new Map((await fetchAllHrPayslips($api, id)).map(row => [row.employee.id, row.employee.name]))
  } catch { refusedNames.value = new Map() }
}

async function transition(action: 'compute' | 'approve' | 'cancel') {
  if (!hydrated.value || pendingAction.value) return
  failure.value = null
  try {
    await transitions[action].mutateAsync()
    if (action === 'cancel') await navigateTo(backTo.value, { replace: true })
  } catch (error) { failure.value = error }
}
async function post() {
  if (!hydrated.value || pendingAction.value) return
  failure.value = null
  try {
    await posting.mutateAsync()
    confirming.value = null
  } catch (error) { failure.value = error }
}
async function postProvision() {
  if (!hydrated.value || pendingAction.value || !run.value) return
  failure.value = null
  provisionFailure.value = null
  try { await provision.mutateAsync(run.value.month) } catch (error) { provisionFailure.value = error }
}
async function recordPayment(body: HrPayrollPaymentCreate) {
  if (!hydrated.value || pendingAction.value) return
  failure.value = null
  try {
    await payment.mutateAsync(body)
    confirming.value = null
  } catch (error) { failure.value = error }
}
// Cells save independently: only the cell being saved waits, and the saves go to the server in the order they were made.
const savingCells = ref<string[]>([])
let saveQueue: Promise<unknown> = Promise.resolve()
function saveInputs(payload: { payslipId: number; body: HrPayslipInputsPatch }) {
  if (!hydrated.value) return
  const key = `${payload.payslipId}:${Object.keys(payload.body)[0]}`
  failure.value = null
  savingCells.value = [...savingCells.value, key]
  saveQueue = saveQueue
    .then(() => patchInputs.mutateAsync(payload))
    .catch((error) => { failure.value = error })
    .finally(() => { savingCells.value = savingCells.value.filter(cell => cell !== key) })
}

const editable = computed(() => !!run.value?.allowed_actions.includes('edit_inputs'))
const title = computed(() => run.value ? t('hrPayroll.run.title', { month: formatPayrollMonth(run.value.month, locale.value) }) : t('hrPayroll.title'))
const tags = computed(() => run.value ? [statusTag({ tone: payrollRunStateTone(run.value.state), label: t(`hrPayroll.runs.state.${run.value.state}`) }, 'hr-payroll-run-state')] : [])
const warnings = computed(() => (run.value?.warnings ?? []).map(warning => ({
  key: `${warning.code}:${warning.employee.id}`,
  text: te(`hrPayroll.warnings.${warning.code}`) ? t(`hrPayroll.warnings.${warning.code}`, { name: warning.employee.name }) : `${warning.code}: ${warning.employee.name}`,
})))
const approval = computed(() => run.value?.approved_by && run.value.approved_at
  ? t('hrPayroll.run.approvedBy', { name: run.value.approved_by.name, date: formatDate(run.value.approved_at) })
  : '')

function payslipTo(row: HrPayslipRow) {
  return recordChildTo(`/hr/payroll/${runId.value}/payslips/${row.id}`, route.query, sourcePaths.value, route.hash)
}
function writeQuery(patch: Partial<{ q: string; offset: number }>) {
  if (!hydrated.value) return
  void router.replace({
    query: { ...route.query, q: (patch.q ?? search.value).trim() || undefined, offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || payslips.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}
// The printed register lists every payslip the run's totals cover: the rows beyond the shown page and those a search
// hides are loaded first, shown for the duration of the print, then dropped again.
const printRows = ref<HrPayslipRow[] | null>(null)
const printing = ref(false)
async function printRegister() {
  if (!hydrated.value || !import.meta.client || printing.value || runId.value === null) return
  printing.value = true
  try {
    printRows.value = await fetchAllHrPayslips($api, runId.value)
    await nextTick()
    window.print()
  } catch (error) { failure.value = error } finally {
    printRows.value = null
    printing.value = false
  }
}
const partial = computed(() => !!run.value && !payslips.isLoading.value && rows.value.length < run.value.employee_count)
</script>

<template>
  <SharedRecordPage
    width="full"
    :keep-content="!!run"
    :title="title"
    :tags="tags"
    :back-to="backTo"
    :loading="runQuery.isLoading.value"
    :error="pageError"
    @retry="runQuery.refetch"
  >
    <template v-if="run" #actions>
      <UButton class="webvue-print-hide" color="neutral" variant="outline" icon="i-lucide-printer" :disabled="!hydrated || printing" :loading="printing" :label="t('hrPayroll.actions.printRegister')" data-testid="hr-payroll-print" @click="printRegister" />
    </template>

    <template v-if="run">
      <UAlert v-if="failureMessage" class="webvue-print-hide" role="alert" color="error" variant="subtle" :title="failureMessage" data-testid="hr-payroll-run-failure" />

      <PayrollRunActions
        :run="run"
        v-model:confirming="confirming"
        :pending="pendingAction"
        :post-ready="!!preview.data.value"
        @compute="transition('compute')"
        @approve="transition('approve')"
        @cancel="transition('cancel')"
        @post="post"
        @eos-provision="postProvision"
      >
        <template #post-preview>
          <UAlert
            v-if="preview.error.value"
            role="alert"
            color="error"
            variant="subtle"
            :title="payrollErrorMessage(preview.error.value, t, employeeNames)"
            data-testid="hr-payroll-preview-failure"
          >
            <template #actions>
              <UButton type="button" color="neutral" variant="outline" :label="t('app.retry')" data-testid="hr-payroll-preview-retry" @click="preview.refetch()" />
            </template>
          </UAlert>
          <SharedPageState v-else :loading="preview.isLoading.value">
            <PayrollPostingPreview v-if="preview.data.value" :preview="preview.data.value" />
          </SharedPageState>
        </template>
        <template #payment-form="{ close }">
          <PayrollPaymentForm
            :journals="paymentJournals"
            :pending="payment.isPending.value"
            :error="failure"
            :default-date="currentPayrollDate()"
            @submit="recordPayment"
            @cancel="close"
          />
        </template>
      </PayrollRunActions>

      <UAlert
        v-if="showFiles && profiles.error.value"
        class="webvue-print-hide"
        role="alert"
        color="error"
        variant="subtle"
        :title="t('hrPayroll.files.profilesError')"
        data-testid="hr-payroll-files-profiles-failure"
      >
        <template #actions>
          <UButton type="button" color="neutral" variant="outline" :label="t('app.retry')" data-testid="hr-payroll-files-profiles-retry" @click="profiles.refetch()" />
        </template>
      </UAlert>
      <PayrollFileActions
        v-if="showFiles"
        :profiles="profiles.data.value?.items ?? []"
        :profiles-ready="!!profiles.data.value"
        :pending="downloading"
        :default-date="currentPayrollDate()"
        :gosi-to="recordChildTo(`/hr/payroll/${run.id}/gosi`, route.query, sourcePaths, route.hash)"
        @download="downloadFile"
      />

      <PayrollRunTotals :totals="run.totals" :employee-count="run.employee_count" />
      <p v-if="approval" class="text-sm text-muted" data-testid="hr-payroll-approval">{{ approval }}</p>
      <p v-if="run.finance?.entry_name" class="text-sm text-muted" data-testid="hr-payroll-entry">{{ t('hrPayroll.finance.entryName', { name: run.finance.entry_name }) }}</p>
      <p v-if="provisionEntry" class="text-sm text-muted" data-testid="hr-payroll-eos-provision-entry">{{ t('hrPayroll.eosProvisions.posted', { name: provisionEntry }) }}</p>
      <p v-if="run.finance?.payment_name" class="text-sm text-muted" data-testid="hr-payroll-payment">{{ t('hrPayroll.finance.paymentName', { name: run.finance.payment_name }) }}</p>

      <UAlert
        v-if="warnings.length"
        class="webvue-print-hide"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t('hrPayroll.warnings.title')"
        data-testid="hr-payroll-warnings"
      >
        <template #description>
          <ul class="list-disc ps-5">
            <li v-for="warning in warnings" :key="warning.key">{{ warning.text }}</li>
          </ul>
        </template>
      </UAlert>

      <SharedRecordSection variant="panel" :title="t('hrPayroll.register.title')" :description="t('hrPayroll.register.hint')">
        <SharedPageState :error="payslips.error.value" :keep-content="rows.length > 0" @retry="payslips.refetch">
          <SharedFilterBar inline class="webvue-print-hide mb-3" :active-count="search.trim() ? 1 : 0" :disabled="!hydrated" @clear="writeQuery({ q: '' })">
            <template #search>
              <UInput
                :model-value="search"
                class="min-w-48 flex-1"
                icon="i-lucide-search"
                :disabled="!hydrated"
                :aria-label="t('hrPayroll.register.search')"
                :placeholder="t('hrPayroll.register.search')"
                data-testid="hr-payroll-search"
                @update:model-value="writeQuery({ q: String($event ?? '') })"
              />
            </template>
          </SharedFilterBar>
          <p v-if="partial && run" class="webvue-print-hide mb-2 text-sm text-muted" data-testid="hr-payroll-register-note">{{ t('hrPayroll.register.footer', { shown: rows.length, total: run.employee_count }) }}</p>
          <SharedEmptyState v-if="!payslips.isLoading.value && (printRows ?? rows).length === 0" compact :title="t('hrPayroll.register.emptyTitle')" :description="t(run.state === 'draft' ? 'hrPayroll.register.emptyDraftHint' : 'hrPayroll.register.emptyHint')" />
          <PayrollInputsTable
            v-else
            :rows="printRows ?? rows"
            :row-to="payslipTo"
            :totals="run.totals"
            :editable="editable"
            :saving="savingCells"
            :loading="payslips.isLoading.value"
            :caption="t('hrPayroll.register.title')"
            @save="saveInputs"
          />
        </SharedPageState>
        <SharedListFooter
          v-if="payslips.data.value && pages > 1"
          class="webvue-print-hide"
          :count-label="t('hrPayroll.register.footer', { shown: rows.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="payslips.isFetching.value"
          count-test-id="hr-payroll-payslip-count"
          @update:page="setPage"
        />
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
