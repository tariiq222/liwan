<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { FinanceInvoice } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import { useFinanceInvoicesByIds, useFinanceOpenInvoices } from '@/composables/finance/useFinanceInvoices'
import { useFinancePaymentJournals, useRegisterFinancePayment } from '@/composables/finance/useFinancePayments'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'
import { invoiceTitle } from '../invoices/invoiceKinds'
import { formatAmount } from '../invoices/formatAmount'
import Money from '../invoices/Money.vue'
import {
  buildPaymentRegister,
  paymentBatchProblem,
  paymentDirection,
  paymentDue,
  validatePaymentDraft,
  type PaymentDraft,
} from './paymentModel'

// Registers one payment against one or more posted documents of the same partner, currency and type. The documents
// come from the link (the record page's "register payment") or from the picker; the amount starts as what is due and
// may be lower (a partial payment) but never higher.
const props = defineProps<{ backTo: RouteLocationRaw; invoiceIds: number[] }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const register = useRegisterFinancePayment()
const journals = useFinancePaymentJournals()

const selectedIds = ref<number[]>([...props.invoiceIds])
const picked = useFinanceInvoicesByIds(selectedIds)
const records = computed(() => picked.value.records)
const q = ref('')
const open = useFinanceOpenInvoices(refDebounced(q, 250))
const items = computed(() => {
  const label = (invoice: Pick<FinanceInvoice, 'id' | 'name' | 'partner' | 'currency' | 'amount_residual'>) => `${invoiceTitle(invoice, t('financeDocuments.draftNumber'))} · ${invoice.partner?.name ?? ''} · ${formatAmount(invoice.amount_residual)} ${invoice.currency}`
  const rows = new Map<number, { value: number; label: string }>()
  for (const invoice of records.value) rows.set(invoice.id, { value: invoice.id, label: label(invoice) })
  for (const invoice of open.data.value?.items ?? []) if (invoice.amount_residual > 0 && !rows.has(invoice.id)) rows.set(invoice.id, { value: invoice.id, label: label(invoice) })
  return [...rows.values()]
})

const problem = computed(() => paymentBatchProblem(records.value))
const due = computed(() => paymentDue(records.value))
const direction = computed(() => paymentDirection(records.value))
const currency = computed(() => records.value[0]?.currency)
const ready = computed(() => records.value.length > 0 && records.value.length === selectedIds.value.length && !problem.value)

const draft = reactive<PaymentDraft>({ amount: '', paymentDate: new Date().toLocaleDateString('en-CA'), journalId: null, memo: '' })
const amountTouched = ref(false)
watch(due, value => { if (!amountTouched.value) draft.amount = value > 0 ? String(value) : '' }, { immediate: true })
const journalItems = computed(() => [...(journals.data.value ?? [])]
  .sort((a, b) => Number(b.currency === currency.value) - Number(a.currency === currency.value))
  .map(journal => ({ value: journal.id, label: `${journal.name} (${journal.currency})` })))
watch(journalItems, rows => { if (draft.journalId === null && rows.length) draft.journalId = rows[0]!.value }, { immediate: true })

const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const errors = computed(() => validatePaymentDraft(draft, due.value))
const shown = computed(() => attempted.value ? errors.value : {})
const dirty = computed(() => !saved.value && (amountTouched.value || !!draft.memo.trim() || selectedIds.value.join() !== props.invoiceIds.join()))
const pending = computed(() => register.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (!ready.value || Object.keys(errors.value).length) return
  try {
    await register.mutateAsync(buildPaymentRegister(selectedIds.value, draft))
    saved.value = true
    await nextTick()
    emit('saved')
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-payment-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-payment-form-error" />
    <SharedFormSection panel :title="t('financeDocuments.payments.form.documents')">
      <div class="grid gap-4">
        <UFormField :label="t('financeDocuments.payments.form.documentsLabel')" name="finance-payment-invoices" required :error="attempted && !selectedIds.length ? t('financeDocuments.payments.form.documentsRequired') : undefined">
          <USelectMenu
            id="finance-payment-invoices"
            v-model:search-term="q"
            :model-value="selectedIds"
            :items="items"
            value-key="value"
            multiple
            :ignore-filter="true"
            :loading="open.isFetching.value"
            :placeholder="t('financeDocuments.payments.form.pickDocuments')"
            :search-input="{ placeholder: t('app.search') }"
            :disabled="!hydrated || pending"
            class="w-full"
            data-testid="finance-payment-invoices"
            @update:model-value="value => { selectedIds = value as number[] }"
          />
        </UFormField>
        <UAlert v-if="picked.error" color="error" variant="subtle" :title="picked.error.message" />
        <UAlert v-else-if="problem" role="alert" color="warning" variant="subtle" :title="t(`financeDocuments.payments.form.problems.${problem}`)" data-testid="finance-payment-problem" />
        <dl v-else-if="records.length" class="grid gap-2 rounded-card bg-elevated p-3 text-sm" data-testid="finance-payment-summary">
          <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeDocuments.payments.partner') }}</dt><dd class="font-semibold text-highlighted">{{ records[0]?.partner?.name }}</dd></div>
          <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeDocuments.payments.type') }}</dt><dd>{{ direction ? t(`financeDocuments.payments.types.${direction}`) : '' }}</dd></div>
          <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeDocuments.payments.form.due') }}</dt><dd class="font-semibold text-highlighted"><Money :amount="due" :currency="currency" /></dd></div>
        </dl>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeDocuments.payments.form.payment')">
      <div class="grid gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeDocuments.payments.amount')" name="finance-payment-amount" required :error="shown.amount === 'required' ? t('financeDocuments.payments.form.amountRequired') : shown.amount === 'exceeds' ? t('financeDocuments.errors.amountExceedsResidual') : undefined">
            <UInput id="finance-payment-amount" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :model-value="draft.amount" :disabled="!hydrated || pending" @update:model-value="value => { draft.amount = String(value ?? ''); amountTouched = true }" />
          </UFormField>
          <UFormField :label="t('financeDocuments.payments.form.date')" name="finance-payment-date" required :error="shown.paymentDate ? t('financeDocuments.payments.form.dateRequired') : undefined">
            <SharedDateField id="finance-payment-date" v-model="draft.paymentDate" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <UFormField :label="t('financeDocuments.payments.form.journal')" name="finance-payment-journal" required :error="shown.journalId ? t('financeDocuments.payments.form.journalRequired') : undefined">
          <SharedPageState :loading="journals.isLoading.value" :error="journals.error.value" :empty="!journals.isLoading.value && !journalItems.length" :empty-text="t('financeDocuments.payments.form.noJournals')" @retry="journals.refetch">
            <USelect id="finance-payment-journal" :model-value="draft.journalId ?? undefined" :items="journalItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="value => { draft.journalId = Number(value) }" />
          </SharedPageState>
        </UFormField>
        <UFormField :label="t('financeDocuments.payments.form.memo')" name="finance-payment-memo">
          <UInput id="finance-payment-memo" v-model="draft.memo" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeDocuments.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t('financeDocuments.payments.form.submit')" data-testid="finance-payment-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
