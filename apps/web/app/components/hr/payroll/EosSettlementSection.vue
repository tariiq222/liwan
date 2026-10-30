<script setup lang="ts">
import { HR_EOS_CASES, HrEosCaseSchema, HrSettlementWriteSchema, type HrEosCase, type HrEosEstimate, type HrSettlement, type HrSettlementWrite } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { formatPayrollAmount, payrollCurrencyLabel } from '@/utils/payrollFormat'
import { parseMoneyInput } from '@/utils/moneyInput'

// The final settlement of a leaver on the offboarding record: the end-of-service award for the chosen case, the paid
// leave balance and the deductions still open. Without a saved settlement the figures are the server's estimate for the
// departure date; a draft is saved with its case and open deductions, and confirming it (inline, pending until the
// server answers) locks the figures for the departure month's payslip. The page owns the queries and the refusal text.
const props = defineProps<{
  /** The saved settlement, or null before the first save. */
  settlement: HrSettlement | null
  /** The server's estimate for the departure date; shown until a settlement is saved. */
  estimate: HrEosEstimate | null
  estimateLoading?: boolean
  canManage: boolean
  canApprove: boolean
  /** The save is in flight. */
  saving: boolean
  /** The confirmation is in flight. */
  confirming: boolean
  /** The text of the last refusal, or an empty string. */
  error: string
}>()
const emit = defineEmits<{ save: [body: HrSettlementWrite]; confirm: [] }>()
/** The award case in the form; null while neither the user nor the server has chosen one. */
const chosenCase = defineModel<HrEosCase | null>('case', { default: null })

const { t, locale } = useI18n()
const hydrated = useHydrated()

const openDeductions = ref('')
const asking = ref(false)
const attempted = ref(false)

const figures = computed(() => props.settlement ?? props.estimate)
const confirmed = computed(() => props.settlement?.state === 'confirmed')
const mismatch = computed(() => props.settlement?.departure_mismatch === true)
// A confirmed settlement is locked, unless the departure date moved: then a new draft for the new date is saved.
const editable = computed(() => props.canManage && (!confirmed.value || mismatch.value))
const busy = computed(() => !hydrated.value || props.saving || props.confirming)
const caseItems = computed(() => HR_EOS_CASES.map(value => ({ value, label: t(`hrPayroll.eos.cases.${value}`) })))
const money = (value: number) => `${formatPayrollAmount(value, locale.value)} ${payrollCurrencyLabel(figures.value?.currency ?? 'SAR', t('hrPayroll.currency'))}`
const days = (value: number) => formatPayrollAmount(value, locale.value)

watch(() => props.settlement, (settlement) => { openDeductions.value = settlement ? String(settlement.open_deductions) : (openDeductions.value || '0') }, { immediate: true })

const parsedDeductions = computed(() => parseMoneyInput(openDeductions.value, 2))
const deductionsError = computed(() => {
  if (!attempted.value || parsedDeductions.value.ok) return undefined
  return t('hrPayroll.eos.deductionsInvalid')
})
const body = computed(() => HrSettlementWriteSchema.safeParse({
  case: chosenCase.value,
  open_deductions: parsedDeductions.value.ok ? parsedDeductions.value.value : Number.NaN,
}))
// A saved draft whose case or deductions were edited shows the server's figures of the last save, marked as stale.
const stale = computed(() => !!props.settlement && editable.value && (chosenCase.value !== props.settlement.case || !parsedDeductions.value.ok || parsedDeductions.value.value !== props.settlement.open_deductions))
const total = computed(() => props.settlement?.total ?? (props.estimate ? props.estimate.award + props.estimate.leave_amount - (parsedDeductions.value.ok ? parsedDeductions.value.value : 0) : null))

function pickCase(value: unknown) {
  const parsed = HrEosCaseSchema.safeParse(value)
  if (parsed.success) chosenCase.value = parsed.data
}
function save() {
  attempted.value = true
  if (busy.value || !body.value.success) return
  emit('save', body.value.data)
}
function confirmSettlement() {
  if (busy.value) return
  emit('confirm')
}
watch(() => props.confirming, (now, was) => { if (was && !now) asking.value = false })
</script>

<template>
  <SharedRecordSection :title="t('hrPayroll.eos.title')" :description="t('hrPayroll.eos.hint')" data-testid="hr-eos-section">
    <template #actions>
      <SharedStatusBadge v-if="settlement" size="sm" :tone="confirmed ? 'success' : 'warning'" :label="t(`hrPayroll.eos.state.${settlement.state}`)" data-testid="hr-eos-state" />
    </template>
    <UAlert v-if="props.error" role="alert" color="error" variant="subtle" :title="props.error" data-testid="hr-eos-failure" />
    <UAlert v-if="mismatch" role="status" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('hrPayroll.eos.mismatch', { date: settlement?.departure_date ? formatDate(settlement.departure_date) : '' })" data-testid="hr-eos-mismatch" />
    <UAlert v-if="stale" role="status" color="info" variant="subtle" icon="i-lucide-info" :title="t('hrPayroll.eos.stale')" data-testid="hr-eos-stale" />
    <div v-if="editable" class="liwan-form-grid">
      <UFormField :label="t('hrPayroll.eos.case')" name="hr-eos-case" required>
        <USelect id="hr-eos-case" :model-value="chosenCase ?? undefined" class="w-full" :items="caseItems" :placeholder="t('hrPayroll.eos.casePlaceholder')" :disabled="busy" data-testid="hr-eos-case" @update:model-value="pickCase" />
      </UFormField>
      <UFormField :label="t('hrPayroll.eos.openDeductions')" name="hr-eos-deductions" :error="deductionsError" :hint="t('hrPayroll.eos.openDeductionsHint')">
        <UInput id="hr-eos-deductions" v-model="openDeductions" class="w-full" inputmode="decimal" dir="ltr" :disabled="busy" data-testid="hr-eos-deductions" />
      </UFormField>
    </div>
    <SharedPageState v-if="!figures" :loading="props.estimateLoading" :empty="!props.estimateLoading" :empty-text="t('hrPayroll.eos.pickCase')" />
    <SharedPropertiesPanel v-else data-testid="hr-eos-figures">
      <SharedPropertyRow :label="t('hrPayroll.eos.serviceYears')" :value="days(figures.service_years)" />
      <SharedPropertyRow :label="t('hrPayroll.eos.wage')" :value="money(figures.eos_wage)" />
      <SharedPropertyRow :label="t('hrPayroll.eos.award')" :value="money(figures.award)" />
      <SharedPropertyRow :label="t('hrPayroll.eos.leaveDays')" :value="days(figures.leave_days)" />
      <SharedPropertyRow :label="t('hrPayroll.eos.leaveAmount')" :value="money(figures.leave_amount)" />
      <SharedPropertyRow :label="t('hrPayroll.eos.openDeductions')" :value="money(settlement ? settlement.open_deductions : (parsedDeductions.ok ? parsedDeductions.value : 0))" />
      <SharedPropertyRow v-if="total !== null" :label="t('hrPayroll.eos.total')" :value="money(total)" data-testid="hr-eos-total" />
    </SharedPropertiesPanel>
    <SharedFormActions v-if="editable">
      <UButton color="primary" icon="i-lucide-save" :loading="props.saving" :disabled="busy || !figures" :label="t('hrPayroll.eos.save')" data-testid="hr-eos-save" @click="save" />
      <UButton v-if="settlement && canApprove" color="primary" variant="outline" icon="i-lucide-badge-check" :disabled="busy" :label="t('hrPayroll.eos.confirm')" data-testid="hr-eos-confirm" @click="asking = true" />
    </SharedFormActions>
    <SharedInlineConfirm
      v-if="asking && settlement && canApprove && !confirmed"
      color="primary"
      :title="t('hrPayroll.eos.confirmTitle')"
      :description="t('hrPayroll.eos.confirmHint')"
      :confirm-label="t('hrPayroll.eos.confirm')"
      :pending="props.confirming"
      @confirm="confirmSettlement"
      @cancel="asking = false"
    />
  </SharedRecordSection>
</template>
