<script setup lang="ts">
import type { FinanceAccount, FinanceSetup } from '@liwan/contracts'
import AccountPicker from '@/components/finance/AccountPicker.vue'
import { ApiError } from '@/composables/useApi'
import { useFinanceSetupScope, useSaveFinanceFiscal } from '@/composables/finance/useFinanceSetup'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import {
  FINANCE_FISCAL_LOCK_FIELDS,
  financeFiscalDelta,
  financeFiscalDraftFromValues,
  financeFiscalFieldError,
  financeFiscalIssues,
  financeFiscalSaveMessage,
  isFinanceContextChanged,
  sameFinanceSetupScope,
  type FinanceFiscalDraft,
  type FinanceFiscalField,
  type FinanceSetupScope,
} from '@/composables/finance/financeFiscalSetup'

// The fiscal year and lock dates of the current company. `scope` is the identity the setup was read for: the write states
// it as a precondition, and the page mounts the card again for another identity, so a draft never moves to one. A draft that
// breaks a rule sends nothing and says which field; the server's refusal keeps the draft.
const props = defineProps<{ setup: FinanceSetup; scope: FinanceSetupScope; canEdit: boolean; contextChanged: boolean; reloadSetup: () => Promise<FinanceSetup> }>()
// `contextChanged`: the server refused a write because the company or sign-in changed. The page owns the notice, since it
// mounts a new card for the new identity. `saved` clears it.
const emit = defineEmits<{ contextChanged: []; saved: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveFiscal } = useSaveFinanceFiscal()
const { read: readScope } = useFinanceSetupScope()

const attempted = ref(false)
const refused = ref<unknown>(null)
let identityChanged = false

const { draft, state, save, revert, reload } = useSettingsForm<FinanceSetup, FinanceFiscalDraft>({
  source: () => props.setup,
  read: setup => financeFiscalDraftFromValues(setup.fiscal),
  save: async (values, latest) => {
    refused.value = null
    const delta = financeFiscalDelta(values, financeFiscalDraftFromValues(latest.fiscal))
    if (!delta) return latest
    try {
      const saved = await saveFiscal({ delta, scope: props.scope })
      // An answer for an identity the screen has left is another screen's outcome: it is not reported here.
      if (!sameFinanceSetupScope(props.scope, readScope())) return latest
      attempted.value = false
      emit('saved')
      toast.add({ title: t('finance.setup.fiscal.saved'), color: 'success' })
      return saved
    } catch (error) {
      refused.value = error
      identityChanged = isFinanceContextChanged(error)
      throw error instanceof ApiError ? new ApiError(error.status, error.code, financeFiscalSaveMessage(error, t), error.field, error.details) : error
    }
  },
  reload: () => props.reloadSetup(),
})

const baseline = computed(() => financeFiscalDraftFromValues(props.setup.fiscal))
const issues = computed(() => financeFiscalIssues(draft.value, baseline.value))
const issuesByField = computed(() => new Map(issues.value.map(issue => [issue.field, issue.code])))
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)

/** The message under one field: what the server refused, or what this draft breaks once a save was tried. */
function fieldMessage(field: FinanceFiscalField) {
  const serverMessage = financeFiscalFieldError(refused.value, field, t)
  if (serverMessage) return serverMessage
  if (!attempted.value) return undefined
  const code = issuesByField.value.get(field)
  return code ? t(`finance.setup.fiscal.errors.${code}`) : undefined
}

// Internal transfers pass through a reconcilable current asset, the only kind the server accepts.
const isTransferAccount = (account: FinanceAccount) => account.reconcile && account.account_type === 'asset_current'

const FIELD_LABELS: Partial<Record<FinanceFiscalField, string>> = { fiscalyear_last_day: 'yearEndDay', fiscalyear_last_month: 'yearEndMonth' }
const fieldLabel = (field: FinanceFiscalField) => t(`finance.setup.fiscal.${FIELD_LABELS[field] ?? field}`)

/** The summary of several broken rules: one linked line per invalid control, next to the field messages. */
const summary = computed(() => attempted.value && issues.value.length > 1
  ? issues.value.map(issue => ({ field: issue.field, label: fieldLabel(issue.field), message: t(`finance.setup.fiscal.errors.${issue.code}`) }))
  : [])

function focusField(field: FinanceFiscalField) {
  document.getElementById(`finance-fiscal-${field}`)?.focus()
}

async function submit() {
  attempted.value = true
  refused.value = null
  const first = issues.value[0]
  if (!first) {
    await save()
    // The draft belongs to an identity the server no longer accepts: drop it and read again under the current one.
    if (identityChanged) {
      identityChanged = false
      undo()
      emit('contextChanged')
    }
    return
  }
  await nextTick()
  focusField(first.field)
}

function undo() {
  attempted.value = false
  refused.value = null
  revert()
}

// A save in flight owns the screen: leaving now would abandon a request whose outcome is unknown, and the shared draft
// guard must not be taken as permission to walk away from it.
onBeforeRouteLeave(() => !state.value.saving)

const monthOptions = computed(() => Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Intl.DateTimeFormat(locale.value, { month: 'long' }).format(new Date(2000, index, 1)),
})))
</script>

<template>
  <SharedSettingsCard
    id="setup-fiscal"
    v-bind="state"
    :title="t('finance.setup.fiscal.title')"
    :description="`${t('finance.setup.fiscal.scopeHint')} ${t('finance.setup.fiscal.locksHint')}`"
    :can-edit="canEdit"
    data-testid="finance-setup-fiscal"
    @save="submit"
    @revert="undo"
    @reload="reload"
  >
    <UAlert v-if="contextChanged" role="alert" color="error" variant="subtle" :description="t('finance.setup.fiscal.errors.request_context_changed')" />
    <UAlert v-if="summary.length" role="alert" color="error" variant="subtle" :title="t('finance.setup.fiscal.errorSummary')" data-testid="finance-fiscal-error-summary">
      <template #description>
        <ul class="grid gap-1">
          <li v-for="item in summary" :key="item.field">
            <a :href="`#finance-fiscal-${item.field}`" class="underline" @click.prevent="focusField(item.field)">{{ item.label }}: {{ item.message }}</a>
          </li>
        </ul>
      </template>
    </UAlert>
    <UFormField orientation="horizontal" :label="t('finance.setup.fiscal.yearEndDay')" name="finance-fiscal-fiscalyear_last_day" :description="t('finance.setup.fiscal.yearEndHint')" :error="fieldMessage('fiscalyear_last_day')">
      <UInput id="finance-fiscal-fiscalyear_last_day" v-model="draft.fiscalyear_last_day" class="w-full" dir="ltr" inputmode="numeric" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('finance.setup.fiscal.yearEndMonth')" name="finance-fiscal-fiscalyear_last_month" :error="fieldMessage('fiscalyear_last_month')">
      <USelect id="finance-fiscal-fiscalyear_last_month" v-model="draft.fiscalyear_last_month" class="w-full" :items="monthOptions" :disabled="locked" />
    </UFormField>
    <UFormField
      v-for="field in FINANCE_FISCAL_LOCK_FIELDS"
      :key="field"
      orientation="horizontal"
      :label="t(`finance.setup.fiscal.${field}`)"
      :name="`finance-fiscal-${field}`"
      :error="fieldMessage(field)"
    >
      <SharedDateField
        :id="`finance-fiscal-${field}`"
        v-model="draft[field]"
        :min-value="baseline[field]"
        :disabled="locked"
        :aria-label="t(`finance.setup.fiscal.${field}`)"
      />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('finance.setup.fiscal.transfer_account_id')" name="finance-fiscal-transfer_account_id" :description="t('finance.setup.fiscal.transferAccountHint')" :error="fieldMessage('transfer_account_id')">
      <AccountPicker
        id="finance-fiscal-transfer_account_id"
        v-model="draft.transfer_account_id"
        account-type="asset_current"
        :allow="isTransferAccount"
        :selected-label="setup.fiscal.transfer_account?.name"
        :placeholder="t('finance.setup.fiscal.transferAccountPlaceholder')"
        :invalid="!!fieldMessage('transfer_account_id')"
        :disabled="locked"
        :aria-label="t('finance.setup.fiscal.transfer_account_id')"
      />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('finance.setup.fiscal.hard_lock_date')" :description="t('finance.setup.fiscal.hardLockHint')">
      <SharedDateField id="finance-fiscal-hard_lock_date" :model-value="setup.fiscal.hard_lock_date" disabled :aria-label="t('finance.setup.fiscal.hard_lock_date')" />
    </UFormField>
  </SharedSettingsCard>
</template>
