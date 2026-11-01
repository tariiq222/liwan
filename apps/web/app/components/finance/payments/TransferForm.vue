<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { FinancePaymentTransferResult } from '@liwan/contracts'
import { useCreateFinanceTransfer, useFinancePaymentJournals } from '@/composables/finance/useFinancePayments'
import { financeErrorMessage } from '../financeErrors'
import Money from '../invoices/Money.vue'
import { PAYMENT_STATE_TONE } from './paymentModel'
import {
  TRANSFER_ACCOUNT_SETUP_PATH,
  buildTransfer,
  firstInvalidTransferControl,
  isTransferAccountMissing,
  transferErrorKey,
  transferJournals,
  validateTransferDraft,
  type TransferDraft,
} from './transferModel'

// Money moved between two of the company's bank or cash journals. The server posts one payment out of the first journal
// and one into the second through the company's transfer account; the answer shows both. The retry key lives in the
// create hook, so pressing save again after a lost answer never books a second transfer.
defineProps<{ backTo: RouteLocationRaw }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const create = useCreateFinanceTransfer()
const journals = useFinancePaymentJournals()

const draft = reactive<TransferDraft>({
  fromJournalId: null,
  toJournalId: null,
  amount: '',
  paymentDate: new Date().toLocaleDateString('en-CA'),
  memo: '',
})
const journalItems = computed(() => transferJournals(journals.data.value ?? []).map(journal => ({ value: journal.id, label: `${journal.name} (${journal.currency})` })))

const attempted = ref(false)
const result = ref<FinancePaymentTransferResult | null>(null)
const error = ref('')
// The one refusal with a way out: the company has no transfer account yet and the fiscal setup chooses it.
const accountMissing = ref(false)
const errors = computed(() => validateTransferDraft(draft))
const shown = computed(() => attempted.value ? errors.value : {})
const dirty = computed(() => !result.value && (!!draft.fromJournalId || !!draft.toJournalId || !!draft.amount || !!draft.memo.trim()))
const pending = computed(() => create.isPending.value)
// A transfer needs two journals to choose between; with fewer the form says so and cannot be sent.
const tooFewJournals = computed(() => !journals.isLoading.value && !journals.error.value && journalItems.value.length < 2)
const locked = computed(() => !hydrated.value || pending.value)

async function submit() {
  if (locked.value) return
  attempted.value = true
  error.value = ''
  accountMissing.value = false
  const invalid = firstInvalidTransferControl(errors.value)
  if (invalid) {
    await nextTick()
    document.getElementById(invalid)?.focus()
    return
  }
  try {
    result.value = await create.mutateAsync(buildTransfer(draft))
  } catch (cause) {
    error.value = financeErrorMessage(cause, transferErrorKey, t)
    accountMissing.value = isTransferAccountMissing(cause)
  }
}

const legs = computed(() => result.value
  ? [
      { key: 'outbound', payment: result.value.outbound },
      { key: 'inbound', payment: result.value.inbound },
    ] as const
  : [])
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <div v-if="result" class="liwan-form" data-testid="finance-transfer-result">
    <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('financeDocuments.payments.transfer.done')" :description="t('financeDocuments.payments.transfer.doneHint')" />
    <SharedFormSection panel :title="t('financeDocuments.payments.transfer.resulting')">
      <ul class="grid gap-3">
        <li v-for="leg in legs" :key="leg.key" class="flex flex-wrap items-center justify-between gap-3 rounded-card bg-elevated p-3" :data-testid="`finance-transfer-${leg.key}`">
          <div class="min-w-0">
            <p class="font-semibold text-highlighted"><bdi>{{ leg.payment.name || `${t('financeDocuments.payments.draftNumber')} #${leg.payment.id}` }}</bdi></p>
            <p class="text-sm text-muted">{{ t(`financeDocuments.payments.transfer.legs.${leg.key}`) }} · {{ leg.payment.journal.name }} · <bdi class="tabular-nums" dir="ltr">{{ leg.payment.date }}</bdi></p>
          </div>
          <div class="flex items-center gap-3">
            <Money :amount="leg.payment.amount" :currency="leg.payment.currency" />
            <SharedStatusBadge size="sm" :tone="PAYMENT_STATE_TONE[leg.payment.state]" :label="t(`financeDocuments.payments.states.${leg.payment.state}`)" />
          </div>
        </li>
      </ul>
    </SharedFormSection>
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton color="primary" :to="backTo" :label="t('financeDocuments.payments.transfer.back')" data-testid="finance-transfer-back" />
      </div>
    </SharedFormActions>
  </div>
  <UForm v-else novalidate :state="draft" class="liwan-form" method="post" data-testid="finance-transfer-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-transfer-error">
      <template v-if="accountMissing" #actions>
        <UButton v-if="can('finance.setup.manage')" color="neutral" variant="outline" size="sm" :to="TRANSFER_ACCOUNT_SETUP_PATH" :label="t('financeDocuments.payments.transfer.openSetup')" data-testid="finance-transfer-open-setup" />
        <span v-else class="text-sm text-muted">{{ t('financeDocuments.payments.transfer.askAdmin') }}</span>
      </template>
    </UAlert>
    <SharedFormSection panel :title="t('financeDocuments.payments.transfer.accounts')" :description="t('financeDocuments.payments.transfer.accountsHint')">
      <SharedPageState :loading="journals.isLoading.value" :error="journals.error.value" :empty="tooFewJournals" :empty-text="t('financeDocuments.payments.transfer.fewJournals')" @retry="journals.refetch">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeDocuments.payments.transfer.from')" name="finance-transfer-from" required :error="shown.fromJournalId ? t('financeDocuments.payments.form.journalRequired') : undefined">
            <USelect id="finance-transfer-from" :model-value="draft.fromJournalId ?? undefined" :items="journalItems" class="w-full" :placeholder="t('financeDocuments.payments.transfer.choose')" :disabled="locked" @update:model-value="value => { draft.fromJournalId = Number(value) }" />
          </UFormField>
          <UFormField :label="t('financeDocuments.payments.transfer.to')" name="finance-transfer-to" required :error="shown.toJournalId ? t(shown.toJournalId === 'same' ? 'financeDocuments.payments.transfer.sameJournal' : 'financeDocuments.payments.form.journalRequired') : undefined">
            <USelect id="finance-transfer-to" :model-value="draft.toJournalId ?? undefined" :items="journalItems" class="w-full" :placeholder="t('financeDocuments.payments.transfer.choose')" :disabled="locked" @update:model-value="value => { draft.toJournalId = Number(value) }" />
          </UFormField>
        </div>
      </SharedPageState>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeDocuments.payments.transfer.details')">
      <div class="grid gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeDocuments.payments.amount')" name="finance-transfer-amount" required :error="shown.amount ? t('financeDocuments.payments.form.amountRequired') : undefined">
            <UInput id="finance-transfer-amount" v-model="draft.amount" inputmode="decimal" class="w-full tabular-nums" :disabled="locked" />
          </UFormField>
          <UFormField :label="t('financeDocuments.payments.transfer.date')" name="finance-transfer-date" required :error="shown.paymentDate ? t('financeDocuments.payments.form.dateRequired') : undefined">
            <SharedDateField id="finance-transfer-date" v-model="draft.paymentDate" :disabled="locked" />
          </UFormField>
        </div>
        <UFormField :label="t('financeDocuments.payments.form.memo')" name="finance-transfer-memo">
          <UInput id="finance-transfer-memo" v-model="draft.memo" class="w-full" maxlength="255" :disabled="locked" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeDocuments.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="locked || tooFewJournals" :loading="pending" :label="t('financeDocuments.payments.transfer.submit')" data-testid="finance-transfer-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
