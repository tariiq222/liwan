<script setup lang="ts">
import type { FinancePartnerBank } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useCreateFinancePartnerBank, useUpdateFinancePartnerBank } from '@/composables/finance/useFinancePartnerBanks'
import {
  bankDraftFromRecord,
  bankFailure,
  buildBankCreate,
  buildBankPatch,
  emptyBankDraft,
  validateBankDraft,
  type PartnerBankDraft,
  type PartnerBankFailure,
} from './partnerBanks'

// Adds a bank account to a partner, or edits the holder, bank and BIC of one (and its number). It opens inside the partner's
// page, never in a dialog. The server sanitizes and validates the number (a Saudi IBAN is checked), and its message for a
// field is shown under that field.
const props = defineProps<{ partnerId: number; account?: FinancePartnerBank }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateFinancePartnerBank(() => props.partnerId)
const update = useUpdateFinancePartnerBank(() => props.partnerId)

const initial = props.account ? bankDraftFromRecord(props.account) : emptyBankDraft()
const draft = reactive<PartnerBankDraft>({ ...initial })
const attempted = ref(false)
const failure = ref<unknown>(null)
const pending = computed(() => create.isPending.value || update.isPending.value)
const locked = computed(() => !hydrated.value || pending.value)
const errors = computed(() => validateBankDraft(draft))
const refusal = computed<PartnerBankFailure | null>(() => bankFailure(failure.value))

function fieldError(field: keyof PartnerBankDraft): string | undefined {
  if (refusal.value?.field === field) return refusal.value.key ? t(refusal.value.key) : refusal.value.message
  if (!attempted.value) return undefined
  if (field === 'accNumber' && errors.value.accNumber) return t('finance.partners.banks.errors.accNumberRequired')
  if (field === 'bankName' && errors.value.bankName) return t('finance.partners.banks.errors.bankNameForBic')
  return undefined
}
// A refusal that names no field (or one this editor does not show) is said once above the fields.
const generalError = computed(() => {
  if (!failure.value) return ''
  if (refusal.value?.field) return ''
  return refusal.value?.key ? t(refusal.value.key) : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
})

async function submit() {
  if (locked.value) return
  attempted.value = true
  failure.value = null
  if (Object.keys(errors.value).length) return
  try {
    if (props.account) {
      const patch = buildBankPatch(draft, initial)
      if (patch) await update.mutateAsync({ id: props.account.id, patch })
    } else {
      await create.mutateAsync(buildBankCreate(draft))
    }
    emit('done')
  } catch (cause) {
    failure.value = cause
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="grid gap-4 p-(--liwan-card-pad)" data-testid="finance-partner-bank-form" @submit="submit">
    <SharedUnsavedChanges :dirty="JSON.stringify(draft) !== JSON.stringify(initial)" />
    <UAlert v-if="generalError" role="alert" color="error" variant="subtle" :title="generalError" data-testid="finance-partner-bank-error" />
    <UFormField :label="t('finance.partners.banks.accNumber')" name="finance-bank-acc-number" required :description="t('finance.partners.banks.accNumberHint')" :error="fieldError('accNumber')">
      <UInput id="finance-bank-acc-number" v-model="draft.accNumber" class="w-full" dir="ltr" autocomplete="off" maxlength="40" :disabled="locked" />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('finance.partners.banks.holderName')" name="finance-bank-holder" :error="fieldError('holderName')">
        <UInput id="finance-bank-holder" v-model="draft.holderName" class="w-full" maxlength="255" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('finance.partners.banks.bankName')" name="finance-bank-name" :error="fieldError('bankName')">
        <UInput id="finance-bank-name" v-model="draft.bankName" class="w-full" maxlength="255" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('finance.partners.banks.bic')" name="finance-bank-bic" :error="fieldError('bic')">
        <UInput id="finance-bank-bic" v-model="draft.bic" class="w-full" dir="ltr" autocomplete="off" maxlength="11" :disabled="locked" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="locked" :loading="pending" :label="t(account ? 'app.save' : 'finance.partners.banks.add')" data-testid="finance-partner-bank-submit" />
    </div>
  </UForm>
</template>
