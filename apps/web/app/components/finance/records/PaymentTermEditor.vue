<script setup lang="ts">
import type { FinancePaymentTerm } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useCreateSetupPaymentTerm, usePatchSetupPaymentTerm } from '@/composables/finance/useFinanceRecords'
import { newTermLine, percentTotal, termCreate, termDraft, termPatch, termValid } from './recordForms'

// The inline form of the payment terms: a name and the installments (a percent or a fixed amount, due so many days after the
// invoice date or its month end). The percent installments must add up to 100; an edit replaces all the installments.
const props = defineProps<{ term?: FinancePaymentTerm }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const draft = reactive(termDraft(props.term))
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateSetupPaymentTerm()
const { mutateAsync: patch, isPending: patching } = usePatchSetupPaymentTerm()
const pending = computed(() => creating.value || patching.value)
const valid = computed(() => termValid(draft))
const total = computed(() => percentTotal(draft))
const valueItems = computed(() => (['percent', 'fixed'] as const).map(value => ({ value, label: t(`financeRecords.paymentTerms.values.${value}`) })))
const delayItems = computed(() => (['days_after', 'days_after_end_of_month', 'days_after_end_of_next_month'] as const).map(value => ({ value, label: t(`financeRecords.paymentTerms.delays.${value}`) })))

function addLine() { draft.lines.push(newTermLine()) }
function removeLine(index: number) { draft.lines.splice(index, 1) }
async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.term) {
      const changes = termPatch(props.term, draft)
      if (changes) await patch({ id: props.term.id, patch: changes })
    } else {
      await create(termCreate(draft))
    }
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="draft" class="webvue-form" method="post" :loading-auto="false" novalidate data-testid="finance-record-term-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeRecords.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeRecords.paymentTerms.form.name')" name="finance-record-term-name" required>
        <UInput id="finance-record-term-name" v-model="draft.name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField v-if="!term" :label="t('financeRecords.paymentTerms.form.note')" name="finance-record-term-note">
        <UInput id="finance-record-term-note" v-model="draft.note" class="w-full" :disabled="!hydrated" />
      </UFormField>
    </div>
    <fieldset class="grid gap-3" :aria-describedby="'finance-record-term-total'">
      <legend class="text-sm font-semibold text-highlighted">{{ t('financeRecords.paymentTerms.form.lines') }}</legend>
      <div v-for="(line, index) in draft.lines" :key="index" class="webvue-form-grid items-end" :data-testid="`finance-record-term-line-${index}`">
        <UFormField :label="t('financeRecords.paymentTerms.form.value')" :name="`finance-record-term-value-${index}`">
          <USelect :id="`finance-record-term-value-${index}`" v-model="line.value" class="w-full" :items="valueItems" :disabled="!hydrated" />
        </UFormField>
        <UFormField :label="t(line.value === 'percent' ? 'financeRecords.paymentTerms.form.percent' : 'financeRecords.paymentTerms.form.amount')" :name="`finance-record-term-amount-${index}`" required>
          <UInputNumber :id="`finance-record-term-amount-${index}`" v-model="line.amount" class="w-full" :min="0" :disabled="!hydrated" />
        </UFormField>
        <UFormField :label="t('financeRecords.paymentTerms.form.days')" :name="`finance-record-term-days-${index}`">
          <UInputNumber :id="`finance-record-term-days-${index}`" v-model="line.days" class="w-full" :min="0" :step="1" :disabled="!hydrated" />
        </UFormField>
        <UFormField :label="t('financeRecords.paymentTerms.form.delay')" :name="`finance-record-term-delay-${index}`">
          <USelect :id="`finance-record-term-delay-${index}`" v-model="line.delay" class="w-full" :items="delayItems" :disabled="!hydrated" />
        </UFormField>
        <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :disabled="!hydrated || draft.lines.length === 1" :aria-label="t('financeRecords.paymentTerms.form.removeLine', { line: index + 1 })" @click="removeLine(index)" />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated" :label="t('financeRecords.paymentTerms.form.addLine')" @click="addLine" />
        <p id="finance-record-term-total" class="text-sm" :class="total === 100 ? 'text-muted' : 'text-error'" data-testid="finance-record-term-total">{{ t('financeRecords.paymentTerms.form.total', { total }) }}</p>
      </div>
    </fieldset>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-record-term-save" />
    </div>
  </UForm>
</template>
