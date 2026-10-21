<script setup lang="ts">
import type { FinanceAccount, FinanceTax } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import AccountPicker from '../AccountPicker.vue'
import { useCreateSetupTax, usePatchSetupTax } from '@/composables/finance/useFinanceRecords'
import { taxCreate, taxDraft, taxPatch, taxValid } from './recordForms'

// The inline form of the taxes: a new sale or purchase tax, or an existing one. Once journal items use a tax only its name can
// change: its kind, rate, price-include setting and tax account are what the posted entries were computed with.
const props = defineProps<{ tax?: FinanceTax }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const draft = reactive(taxDraft(props.tax))
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateSetupTax()
const { mutateAsync: patch, isPending: patching } = usePatchSetupTax()
const pending = computed(() => creating.value || patching.value)
const valid = computed(() => taxValid(draft))
const locked = computed(() => !!props.tax?.used)
const fixedAtCreation = computed(() => !!props.tax)
const useItems = computed(() => (['sale', 'purchase'] as const).map(value => ({ value, label: t(`financeRecords.taxes.uses.${value}`) })))
const typeItems = computed(() => (['percent', 'fixed'] as const).map(value => ({ value, label: t(`financeRecords.taxes.amountTypes.${value}`) })))
// The tax amount is booked on a balance sheet account of its own, never on a receivable or payable one.
const taxAccount = (account: FinanceAccount) => !['asset_receivable', 'liability_payable', 'off_balance'].includes(account.account_type)

async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.tax) {
      const changes = taxPatch(props.tax, draft)
      if (changes) await patch({ id: props.tax.id, patch: changes })
    } else {
      await create(taxCreate(draft))
    }
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="draft" class="webvue-form" method="post" :loading-auto="false" novalidate data-testid="finance-record-tax-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeRecords.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <UAlert v-if="locked" color="info" variant="subtle" icon="i-lucide-lock" :description="t('financeRecords.taxes.lockedNote')" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeRecords.taxes.form.name')" name="finance-record-tax-name" required>
        <UInput id="finance-record-tax-name" v-model="draft.name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeRecords.taxes.form.use')" name="finance-record-tax-use" required>
        <USelect id="finance-record-tax-use" v-model="draft.use" class="w-full" :items="useItems" :disabled="!hydrated || fixedAtCreation" />
      </UFormField>
      <UFormField :label="t('financeRecords.taxes.form.amountType')" name="finance-record-tax-type" required>
        <USelect id="finance-record-tax-type" v-model="draft.amountType" class="w-full" :items="typeItems" :disabled="!hydrated || fixedAtCreation" />
      </UFormField>
      <UFormField :label="t(draft.amountType === 'percent' ? 'financeRecords.taxes.form.rate' : 'financeRecords.taxes.form.amount')" name="finance-record-tax-amount" required>
        <UInputNumber id="finance-record-tax-amount" v-model="draft.amount" class="w-full" :min="0" :disabled="!hydrated || locked" />
      </UFormField>
      <UFormField :label="t('financeRecords.taxes.form.taxAccount')" name="finance-record-tax-account" :help="t('financeRecords.taxes.form.taxAccountHelp')" required>
        <AccountPicker id="finance-record-tax-account" v-model="draft.taxAccountId" :allow="taxAccount" :disabled="locked" :aria-label="t('financeRecords.taxes.form.taxAccount')" />
      </UFormField>
      <USwitch v-model="draft.priceInclude" :label="t('financeRecords.taxes.form.priceInclude')" :disabled="!hydrated || locked" />
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-record-tax-save" />
    </div>
  </UForm>
</template>
