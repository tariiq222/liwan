<script setup lang="ts">
import {
  HR_PAYROLL_ACCOUNT_ROLES,
  HR_PAYROLL_ENTRY_DETAILS,
  type HrPayrollFinanceSettings,
} from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { NO_RECORD, accountChoicesFor, payrollFinanceDraft, payrollFinancePatch, withCurrent, type FinanceChoice, type PayrollFinanceDraft } from '@/utils/payrollFinanceSettings'
import { payrollFieldError } from '@/utils/payrollErrors'

// The accounting mapping of payroll: the journal the entry goes to, its level of detail, the default cost center and the
// account of each role. It saves only what changed, and only for `finance.setup.manage`; the pickers are filled from the
// finance lookups the user may read. The mapping carries no revision, so the card saves the changed parts alone.
const props = defineProps<{
  settings: HrPayrollFinanceSettings
  canEdit: boolean
  /** The general journals, the accounts and the analytic accounts, each null when the user cannot read them. */
  journals: FinanceChoice[] | null
  accounts: FinanceChoice[] | null
  analyticAccounts: FinanceChoice[] | null
  /** True when a list holds more records than were loaded: the pickers then show only the first ones (and the set values). */
  truncated: boolean
  reloadSettings: () => Promise<HrPayrollFinanceSettings>
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = usePatchHrPayrollFinanceSettings()

// What the server refused about one of these fields on the last save.
const refused = ref<unknown>(null)
const { draft, state, save, revert, reload } = useSettingsForm<HrPayrollFinanceSettings, PayrollFinanceDraft>({
  source: () => props.settings,
  read: payrollFinanceDraft,
  save: async (values, latest) => {
    refused.value = null
    const changes = payrollFinancePatch(latest, values)
    if (!Object.keys(changes).length) return latest
    try {
      return await saveSettings(changes)
    } catch (error) {
      refused.value = error
      throw error
    }
  },
  reload: () => props.reloadSettings(),
})
const disabled = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)

const none = { value: NO_RECORD, label: t('hrPayroll.financeSettings.none') }
const items = (choices: FinanceChoice[], current: { id: number; name: string } | null) => [none, ...withCurrent(choices, current).map(choice => ({ value: String(choice.id), label: choice.code ? `${choice.code} ${choice.name}` : choice.name }))]
const detailItems = HR_PAYROLL_ENTRY_DETAILS.map(value => ({ value, label: t(`hrPayroll.financeSettings.${value}`) }))
const fieldError = (field: string) => payrollFieldError(refused.value, t, field)
const readOnly = (record: { name: string } | null) => record?.name ?? t('hrPayroll.financeSettings.notSet')
const submit = () => {
  if (disabled.value) return
  return save()
}
</script>

<template>
  <SharedSettingsCard id="payroll-finance" v-bind="state" :title="t('hrPayroll.financeSettings.title')" :description="t('hrPayroll.financeSettings.hint')" :can-edit="canEdit" data-testid="hr-payroll-finance-form" @save="submit" @revert="revert" @reload="reload">
    <UAlert v-if="truncated" color="info" variant="subtle" icon="i-lucide-info" :title="t('hrPayroll.financeSettings.truncated')" data-testid="hr-payroll-finance-truncated" />
    <UFormField orientation="horizontal" :label="t('hrPayroll.financeSettings.journal')" name="hr-payroll-finance-journal" :error="fieldError('journal_id')">
      <USelect v-if="journals" id="hr-payroll-finance-journal" v-model="draft.journal" class="w-full" :items="items(journals, settings.journal)" :placeholder="t('hrPayroll.financeSettings.journalPlaceholder')" :disabled="disabled" data-testid="hr-payroll-finance-journal" />
      <UInput v-else id="hr-payroll-finance-journal" class="w-full" :model-value="readOnly(settings.journal)" readonly disabled />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('hrPayroll.financeSettings.entryDetail')" name="hr-payroll-finance-detail" :error="fieldError('entry_detail')">
      <USelect id="hr-payroll-finance-detail" v-model="draft.entryDetail" class="w-full" :items="detailItems" :disabled="disabled" data-testid="hr-payroll-finance-detail" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('hrPayroll.financeSettings.defaultAnalytic')" name="hr-payroll-finance-analytic" :description="t('hrPayroll.financeSettings.defaultAnalyticHint')" :error="fieldError('default_analytic_account_id')">
      <USelect v-if="analyticAccounts" id="hr-payroll-finance-analytic" v-model="draft.defaultAnalytic" class="w-full" :items="items(analyticAccounts, settings.default_analytic_account)" :disabled="disabled" data-testid="hr-payroll-finance-analytic" />
      <UInput v-else id="hr-payroll-finance-analytic" class="w-full" :model-value="readOnly(settings.default_analytic_account)" readonly disabled />
    </UFormField>
    <UFormField
      v-for="role in HR_PAYROLL_ACCOUNT_ROLES"
      :key="role"
      orientation="horizontal"
      :label="t(`hrPayroll.financeSettings.roles.${role}`)"
      :name="`hr-payroll-finance-account-${role}`"
      :error="fieldError(`accounts.${role}`)"
    >
      <USelect v-if="accounts" :id="`hr-payroll-finance-account-${role}`" v-model="draft.accounts[role]" class="w-full" :items="items(accountChoicesFor(role, accounts), settings.accounts[role])" :disabled="disabled" :data-testid="`hr-payroll-finance-account-${role}`" />
      <UInput v-else :id="`hr-payroll-finance-account-${role}`" class="w-full" :model-value="readOnly(settings.accounts[role])" readonly disabled />
    </UFormField>
  </SharedSettingsCard>
</template>
