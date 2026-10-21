<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useCreateStandalonePayment, useFinancePaymentJournals } from '@/composables/finance/useFinancePayments'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import {
  PAYMENT_TYPES,
  buildStandalonePayment,
  defaultPartnerType,
  validateStandaloneDraft,
  type StandalonePaymentDraft,
} from './paymentModel'

// A receipt or payment that names no document: an advance, or money to allocate later from the payment's row.
// The retry key lives in the create hook, so pressing save again after a lost answer never books a second payment.
defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateStandalonePayment()
const journals = useFinancePaymentJournals()

const draft = reactive<StandalonePaymentDraft>({
  paymentType: 'inbound',
  partnerType: 'customer',
  partnerId: null,
  amount: '',
  paymentDate: new Date().toLocaleDateString('en-CA'),
  journalId: null,
  memo: '',
})
const typeItems = PAYMENT_TYPES.map(type => ({ value: type, label: t(`financeDocuments.payments.types.${type}`) }))
const partnerTypeItems = (['customer', 'supplier'] as const).map(type => ({ value: type, label: t(`financeDocuments.payments.partnerTypes.${type}`) }))
const journalItems = computed(() => (journals.data.value ?? []).map(journal => ({ value: journal.id, label: `${journal.name} (${journal.currency})` })))
watch(journalItems, rows => { if (draft.journalId === null && rows.length) draft.journalId = rows[0]!.value }, { immediate: true })
function chooseType(value: unknown) {
  draft.paymentType = value as StandalonePaymentDraft['paymentType']
  draft.partnerType = defaultPartnerType(draft.paymentType)
  draft.partnerId = null
}
function chooseParty(value: unknown) {
  draft.partnerType = value as StandalonePaymentDraft['partnerType']
  draft.partnerId = null
}

const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const errors = computed(() => validateStandaloneDraft(draft))
const shown = computed(() => attempted.value ? errors.value : {})
const dirty = computed(() => !saved.value && (!!draft.partnerId || !!draft.amount || !!draft.memo.trim()))
const pending = computed(() => create.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (Object.keys(errors.value).length) return
  try {
    await create.mutateAsync(buildStandalonePayment(draft))
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
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-standalone-payment-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-standalone-payment-error" />
    <SharedFormSection panel :title="t('financeDocuments.payments.standalone.party')">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('financeDocuments.payments.type')" name="finance-standalone-type" required>
          <USelect id="finance-standalone-type" class="w-full" :model-value="draft.paymentType" :items="typeItems" :disabled="!hydrated || pending" @update:model-value="chooseType" />
        </UFormField>
        <UFormField :label="t('financeDocuments.payments.standalone.partnerType')" name="finance-standalone-partner-type" required>
          <USelect id="finance-standalone-partner-type" class="w-full" :model-value="draft.partnerType" :items="partnerTypeItems" :disabled="!hydrated || pending" @update:model-value="chooseParty" />
        </UFormField>
        <UFormField class="sm:col-span-2" :label="t('financeDocuments.payments.partner')" name="finance-standalone-partner" required :error="shown.partnerId ? t('financeDocuments.payments.standalone.partnerRequired') : undefined">
          <PartnerPicker id="finance-standalone-partner" :model-value="draft.partnerId" :kind="draft.partnerType === 'customer' ? 'customer' : 'vendor'" :disabled="!hydrated || pending" :invalid="!!shown.partnerId" @update:model-value="value => { draft.partnerId = value }" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeDocuments.payments.form.payment')">
      <div class="grid gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeDocuments.payments.amount')" name="finance-standalone-amount" required :error="shown.amount ? t('financeDocuments.payments.form.amountRequired') : undefined">
            <UInput id="finance-standalone-amount" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" v-model="draft.amount" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField :label="t('financeDocuments.payments.form.date')" name="finance-standalone-date" required :error="shown.paymentDate ? t('financeDocuments.payments.form.dateRequired') : undefined">
            <SharedDateField id="finance-standalone-date" v-model="draft.paymentDate" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <UFormField :label="t('financeDocuments.payments.form.journal')" name="finance-standalone-journal" required :error="shown.journalId ? t('financeDocuments.payments.form.journalRequired') : undefined">
          <SharedPageState :loading="journals.isLoading.value" :error="journals.error.value" :empty="!journals.isLoading.value && !journalItems.length" :empty-text="t('financeDocuments.payments.form.noJournals')" @retry="journals.refetch">
            <USelect id="finance-standalone-journal" :model-value="draft.journalId ?? undefined" :items="journalItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="value => { draft.journalId = Number(value) }" />
          </SharedPageState>
        </UFormField>
        <UFormField :label="t('financeDocuments.payments.form.memo')" name="finance-standalone-memo">
          <UInput id="finance-standalone-memo" v-model="draft.memo" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeDocuments.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t('financeDocuments.payments.standalone.submit')" data-testid="finance-standalone-payment-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
