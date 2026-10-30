<script setup lang="ts">
import {
  HR_PAYROLL_ACCOUNT_ROLES,
  HR_PAYROLL_ENTRY_DETAILS,
  HrPayrollFinanceSettingsPatchSchema,
  type HrPayrollFinanceSettings,
} from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { NO_RECORD, payrollFinanceDraft, payrollFinancePatch, withCurrent, type FinanceChoice } from '@/utils/payrollFinanceSettings'
import { payrollFieldError } from '@/utils/payrollErrors'

// The accounting mapping of payroll: the journal the entry goes to, its level of detail, the default cost center and
// the account of each role. It saves only what changed, and only for `finance.setup.manage`; the pickers are filled
// from the finance lookups the user may read.
const props = defineProps<{
  settings: HrPayrollFinanceSettings
  canEdit: boolean
  /** The general journals, the accounts and the analytic accounts, each null when the user cannot read them. */
  journals: FinanceChoice[] | null
  accounts: FinanceChoice[] | null
  analyticAccounts: FinanceChoice[] | null
  /** True when a list holds more records than were loaded: the pickers then show only the first ones (and the set values). */
  truncated: boolean
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = usePatchHrPayrollFinanceSettings()

const draft = reactive(payrollFinanceDraft(props.settings))
const failure = ref<unknown>(null)
const patch = computed(() => payrollFinancePatch(props.settings, draft))
const dirty = computed(() => Object.keys(patch.value).length > 0)
function seed(settings: HrPayrollFinanceSettings) {
  const next = payrollFinanceDraft(settings)
  Object.assign(draft, next, { accounts: { ...next.accounts } })
}
// A background refetch must not discard unsaved edits: re-seed only a form that has no changes.
watch(() => props.settings, (settings) => { if (!dirty.value) seed(settings) })

const none = { value: NO_RECORD, label: t('hrPayroll.financeSettings.none') }
const items = (choices: FinanceChoice[], current: { id: number; name: string } | null) => [none, ...withCurrent(choices, current).map(choice => ({ value: String(choice.id), label: choice.code ? `${choice.code} ${choice.name}` : choice.name }))]
const detailItems = HR_PAYROLL_ENTRY_DETAILS.map(value => ({ value, label: t(`hrPayroll.financeSettings.${value}`) }))
const disabled = computed(() => !hydrated.value || !props.canEdit || isPending.value)

const serverField = computed(() => failure.value instanceof ApiError ? failure.value.field : undefined)
const alertMessage = computed(() => failure.value && !serverField.value
  ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
  : undefined)
const fieldError = (field: string) => payrollFieldError(failure.value, t, field)
const readOnly = (record: { name: string } | null) => record?.name ?? t('hrPayroll.financeSettings.notSet')

async function submit() {
  if (disabled.value || !dirty.value) return
  failure.value = null
  const parsed = HrPayrollFinanceSettingsPatchSchema.safeParse(patch.value)
  if (!parsed.success) return
  try {
    seed(await save(parsed.data))
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="draft" class="liwan-form" method="post" data-testid="hr-payroll-finance-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="props.truncated" color="info" variant="subtle" icon="i-lucide-info" :title="t('hrPayroll.financeSettings.truncated')" data-testid="hr-payroll-finance-truncated" />
    <UAlert v-if="alertMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.financeSettings.saveError')" :description="alertMessage" />
    <SharedFormSection panel :title="t('hrPayroll.financeSettings.title')" :description="t('hrPayroll.financeSettings.hint')">
      <div class="liwan-form-grid">
        <UFormField :label="t('hrPayroll.financeSettings.journal')" name="hr-payroll-finance-journal" :error="fieldError('journal_id')">
          <USelect v-if="props.journals" id="hr-payroll-finance-journal" v-model="draft.journal" class="w-full" :items="items(props.journals, props.settings.journal)" :placeholder="t('hrPayroll.financeSettings.journalPlaceholder')" :disabled="disabled" data-testid="hr-payroll-finance-journal" />
          <UInput v-else id="hr-payroll-finance-journal" class="w-full" :model-value="readOnly(props.settings.journal)" readonly disabled />
        </UFormField>
        <UFormField :label="t('hrPayroll.financeSettings.entryDetail')" name="hr-payroll-finance-detail" :error="fieldError('entry_detail')">
          <USelect id="hr-payroll-finance-detail" v-model="draft.entryDetail" class="w-full" :items="detailItems" :disabled="disabled" data-testid="hr-payroll-finance-detail" />
        </UFormField>
        <UFormField :label="t('hrPayroll.financeSettings.defaultAnalytic')" name="hr-payroll-finance-analytic" :help="t('hrPayroll.financeSettings.defaultAnalyticHint')" :error="fieldError('default_analytic_account_id')">
          <USelect v-if="props.analyticAccounts" id="hr-payroll-finance-analytic" v-model="draft.defaultAnalytic" class="w-full" :items="items(props.analyticAccounts, props.settings.default_analytic_account)" :disabled="disabled" data-testid="hr-payroll-finance-analytic" />
          <UInput v-else id="hr-payroll-finance-analytic" class="w-full" :model-value="readOnly(props.settings.default_analytic_account)" readonly disabled />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hrPayroll.financeSettings.accountsTitle')">
      <div class="liwan-form-grid">
        <UFormField
          v-for="role in HR_PAYROLL_ACCOUNT_ROLES"
          :key="role"
          :label="t(`hrPayroll.financeSettings.roles.${role}`)"
          :name="`hr-payroll-finance-account-${role}`"
          :error="fieldError(`accounts.${role}`)"
        >
          <USelect v-if="props.accounts" :id="`hr-payroll-finance-account-${role}`" v-model="draft.accounts[role]" class="w-full" :items="items(props.accounts, props.settings.accounts[role])" :disabled="disabled" :data-testid="`hr-payroll-finance-account-${role}`" />
          <UInput v-else :id="`hr-payroll-finance-account-${role}`" class="w-full" :model-value="readOnly(props.settings.accounts[role])" readonly disabled />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" color="primary" class="ms-auto" :disabled="disabled || !dirty" :loading="isPending" :label="t('app.saveChanges')" data-testid="hr-payroll-finance-submit" />
    </SharedFormActions>
  </UForm>
</template>
