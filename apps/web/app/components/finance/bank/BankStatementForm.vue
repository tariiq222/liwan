<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useCreateFinanceBankStatement, useFinanceBankJournals } from '@/composables/finance/useFinanceBank'
import { formatAmount } from '../invoices/formatAmount'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import {
  MAX_STATEMENT_LINES,
  bankDraftDirty,
  checkBankDraft,
  emptyBankDraft,
  endingBalance,
  endingDifference,
  linesTotal,
  newBankLine,
  type BankStatementDraft,
} from './bankDraft'
import { financeErrorMessage } from '../financeErrors'
import { bankErrorKey } from './bankErrors'

// The create panel of a statement: the header (bank journal, date, name, the balances the bank printed) and its lines,
// where a positive amount is money in and a negative one money out. Numbers stay as typed until validated; the ending
// balance is computed from the opening balance and the lines, and compared with the one the bank printed.
defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateFinanceBankStatement()
const journals = useFinanceBankJournals()

const draft = reactive<BankStatementDraft>(emptyBankDraft(new Date().toLocaleDateString('en-CA')))
const journalItems = computed(() => (journals.data.value?.items ?? []).map(journal => ({ value: journal.id, label: `${journal.name} (${journal.currency})` })))
watch(journalItems, rows => { if (draft.journalId === null && rows.length) draft.journalId = rows[0]!.value }, { immediate: true })

const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const check = computed(() => checkBankDraft(draft))
const shown = computed(() => attempted.value && check.value.errors ? check.value.errors : {})
const dirty = computed(() => !saved.value && bankDraftDirty(draft))
const pending = computed(() => create.isPending.value)
const computedEnd = computed(() => endingBalance(draft))
const difference = computed(() => endingDifference(draft))
const currency = computed(() => journals.data.value?.items.find(journal => journal.id === draft.journalId)?.currency)

function addLine() { draft.lines.push(newBankLine(draft.lines.at(-1)?.date ?? draft.date)) }
function removeLine(index: number) { if (draft.lines.length > 1) draft.lines.splice(index, 1) }
const ariaLine = (index: number, field: string) => t('financeBank.form.lineAria', { number: index + 1, field })

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (!check.value.body) return
  try {
    const record = await create.mutateAsync(check.value.body)
    saved.value = true
    await nextTick()
    emit('saved', record.id)
  } catch (cause) {
    error.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="draft" class="liwan-form" method="post" data-testid="finance-bank-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-bank-form-error" />
    <SharedFormSection panel :title="t('financeBank.form.details')">
      <div class="grid gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeBank.form.journal')" name="finance-bank-journal" required :error="shown.journal_id ? t('financeBank.form.journalRequired') : undefined">
            <SharedPageState :loading="journals.isLoading.value" :error="journals.error.value" :empty="!journals.isLoading.value && !journalItems.length" :empty-text="t('financeBank.form.noJournals')" @retry="journals.refetch">
              <USelect id="finance-bank-journal" :model-value="draft.journalId ?? undefined" :items="journalItems" class="w-full" :color="shown.journal_id ? 'error' : undefined" :disabled="!hydrated || pending" @update:model-value="value => { draft.journalId = Number(value) }" />
            </SharedPageState>
          </UFormField>
          <UFormField :label="t('financeBank.form.date')" name="finance-bank-date" required :error="shown.date ? t('financeBank.form.dateRequired') : undefined">
            <SharedDateField id="finance-bank-date" v-model="draft.date" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <UFormField :label="t('financeBank.form.name')" name="finance-bank-name" :hint="t('financeBank.form.nameHint')" :error="shown.name ? t('financeBank.form.nameInvalid') : undefined">
          <UInput id="finance-bank-name" v-model="draft.name" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeBank.form.balanceStart')" name="finance-bank-balance-start" :error="shown.balance_start ? t('financeBank.form.numberInvalid') : undefined">
            <UInput id="finance-bank-balance-start" v-model="draft.balanceStart" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField :label="t('financeBank.form.balanceEndReal')" name="finance-bank-balance-end" :error="shown.balance_end_real ? t('financeBank.form.numberInvalid') : undefined">
            <UInput id="finance-bank-balance-end" v-model="draft.balanceEndReal" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeBank.form.lines')" :description="t('financeBank.form.linesHint')">
      <ol class="grid gap-4" data-testid="finance-bank-lines">
        <li v-for="(line, index) in draft.lines" :key="line.key" class="grid gap-3 rounded-card bg-elevated p-3 md:grid-cols-[9rem_minmax(0,1fr)_10rem] md:items-start" :data-testid="`finance-bank-line-${index}`">
          <UFormField :label="t('financeBank.form.lineDate')" :name="`finance-bank-line-date-${index}`" required :error="shown[`lines.${index}.date`] ? t('financeBank.form.dateRequired') : undefined">
            <SharedDateField v-model="line.date" :aria-label="ariaLine(index, t('financeBank.form.lineDate'))" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField :label="t('financeBank.form.lineLabel')" :name="`finance-bank-line-label-${index}`" required :error="shown[`lines.${index}.payment_ref`] ? t('financeBank.form.lineLabelRequired') : undefined">
            <UInput v-model="line.paymentRef" class="w-full" maxlength="255" :disabled="!hydrated || pending" :aria-label="ariaLine(index, t('financeBank.form.lineLabel'))" />
          </UFormField>
          <UFormField :label="t('financeBank.form.lineAmount')" :name="`finance-bank-line-amount-${index}`" required :error="shown[`lines.${index}.amount`] ? t('financeBank.form.lineAmountInvalid') : undefined">
            <UInput v-model="line.amount" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" :aria-label="ariaLine(index, t('financeBank.form.lineAmount'))" />
          </UFormField>
          <div class="flex flex-wrap items-end justify-between gap-3 md:col-span-3">
            <UFormField :label="t('financeBank.form.linePartner')" :name="`finance-bank-line-partner-${index}`" class="min-w-0 grow md:max-w-sm">
              <PartnerPicker v-model="line.partnerId" kind="any" :disabled="pending" :aria-label="ariaLine(index, t('financeBank.form.linePartner'))" :placeholder="t('financeBank.form.partnerPlaceholder')" />
            </UFormField>
            <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :disabled="!hydrated || pending || draft.lines.length === 1" :aria-label="t('financeBank.form.removeLine', { number: index + 1 })" @click="removeLine(index)" />
          </div>
        </li>
      </ol>
      <UAlert v-if="shown.lines" class="mt-4" role="alert" color="error" variant="subtle" :title="t('financeBank.form.linesInvalid')" />
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated || pending || draft.lines.length >= MAX_STATEMENT_LINES" :label="t('financeBank.form.addLine')" data-testid="finance-bank-add-line" @click="addLine" />
        <p class="text-sm text-muted">{{ t('financeBank.form.linesTotal') }} <span class="font-semibold text-highlighted tabular-nums"><bdi>{{ formatAmount(linesTotal(draft)) }}</bdi></span></p>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeBank.form.balances')">
      <dl class="grid gap-2 text-sm" data-testid="finance-bank-balances">
        <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.form.computedEnd') }}</dt><dd class="font-semibold text-highlighted tabular-nums"><bdi>{{ formatAmount(computedEnd) }}</bdi><span v-if="currency" class="ms-1 text-muted">{{ currency }}</span></dd></div>
      </dl>
      <UAlert v-if="difference !== null" class="mt-3" role="status" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('financeBank.form.differenceWarning', { amount: formatAmount(difference) })" data-testid="finance-bank-difference" />
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeBank.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t('financeBank.form.submit')" data-testid="finance-bank-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
