<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useCreateJournalEntry, useFinanceGeneralJournals } from '@/composables/finance/useFinanceEntries'
import Money from '../invoices/Money.vue'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import AccountPicker from '../AccountPicker.vue'
import { entryErrorMessage } from './entryErrors'
import {
  buildEntryCreate,
  emptyEntryDraft,
  entryBalanced,
  entryDraftDirty,
  entryTotals,
  hasEntryErrors,
  newEntryLine,
  validateEntryDraft,
  type EntryFormDraft,
} from './entryLines'

// The editor of a new manual entry: the header, then the debit and credit lines with their running totals. Amounts
// stay as typed until validated; the server has the last word on the period lock and the balance.
defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateJournalEntry()
const journals = useFinanceGeneralJournals()

const baseline = emptyEntryDraft()
const draft = reactive<EntryFormDraft>(structuredClone(toRaw(baseline)))
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const dirty = computed(() => !saved.value && entryDraftDirty(draft, baseline))
const errors = computed(() => validateEntryDraft(draft))
const shown = computed(() => attempted.value ? errors.value : null)
const totals = computed(() => entryTotals(draft.lines))
const balanced = computed(() => entryBalanced(totals.value))
const journalItems = computed(() => (journals.data.value?.items ?? []).map(journal => ({ value: journal.id, label: journal.name })))
const currency = computed(() => journals.data.value?.items.find(journal => journal.id === draft.journalId)?.currency)
const pending = computed(() => create.isPending.value)

function addLine() { draft.lines.push(newEntryLine()) }
function removeLine(index: number) { if (draft.lines.length > 2) draft.lines.splice(index, 1) }

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (hasEntryErrors(errors.value)) return
  try {
    const record = await create.mutateAsync(buildEntryCreate(draft))
    saved.value = true
    await nextTick()
    emit('saved', record.id)
  } catch (cause) {
    error.value = entryErrorMessage(cause, t)
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-entry-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-entry-form-error" />
    <SharedFormSection panel :title="t('financeAccounting.form.details')">
      <div class="grid gap-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeAccounting.form.journal')" name="finance-entry-journal" required :error="shown?.journal ? t('financeAccounting.form.journalRequired') : undefined">
            <USelect id="finance-entry-journal" :model-value="draft.journalId ?? undefined" class="w-full" :items="journalItems" :loading="journals.isPending.value" :placeholder="t('financeAccounting.form.journalPlaceholder')" :color="shown?.journal ? 'error' : undefined" :disabled="!hydrated || pending" @update:model-value="draft.journalId = $event" />
          </UFormField>
          <UFormField :label="t('financeAccounting.form.date')" name="finance-entry-date" required :error="shown?.date ? t('financeAccounting.form.dateRequired') : undefined">
            <SharedDateField id="finance-entry-date" v-model="draft.date" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <UFormField :label="t('financeAccounting.form.ref')" name="finance-entry-ref">
          <UInput id="finance-entry-ref" v-model="draft.ref" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeAccounting.form.lines')" :description="t('financeAccounting.form.linesHint')">
      <ol class="grid gap-4" data-testid="finance-entry-lines">
        <li v-for="(line, index) in draft.lines" :key="line.key" class="grid gap-3 rounded-card bg-elevated p-3 md:grid-cols-2" :data-testid="`finance-entry-line-${index}`">
          <UFormField :label="t('financeAccounting.form.account')" :name="`finance-line-account-${index}`" required :error="shown?.lines[index]?.account ? t('financeAccounting.form.accountRequired') : undefined">
            <AccountPicker v-model="line.accountId" :disabled="pending" :invalid="!!shown?.lines[index]?.account" :aria-label="t('financeAccounting.form.lineAria', { number: index + 1, field: t('financeAccounting.form.account') })" />
          </UFormField>
          <UFormField :label="t('financeAccounting.form.partner')" :name="`finance-line-partner-${index}`">
            <PartnerPicker v-model="line.partnerId" kind="any" :disabled="pending" :placeholder="t('financeAccounting.form.partnerPlaceholder')" :aria-label="t('financeAccounting.form.lineAria', { number: index + 1, field: t('financeAccounting.form.partner') })" />
          </UFormField>
          <UFormField :label="t('financeAccounting.form.lineName')" :name="`finance-line-name-${index}`" required :error="shown?.lines[index]?.name ? t('financeAccounting.form.lineNameRequired') : undefined" class="md:col-span-2">
            <UInput v-model="line.name" class="w-full" maxlength="255" :disabled="!hydrated || pending" :aria-label="t('financeAccounting.form.lineAria', { number: index + 1, field: t('financeAccounting.form.lineName') })" />
          </UFormField>
          <div class="grid gap-3 md:col-span-2 md:grid-cols-[1fr_1fr_auto] md:items-start">
            <UFormField :label="t('financeAccounting.form.debit')" :name="`finance-line-debit-${index}`" :error="shown?.lines[index]?.amount ? t('financeAccounting.form.amountInvalid') : undefined">
              <UInput v-model="line.debit" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" :aria-label="t('financeAccounting.form.lineAria', { number: index + 1, field: t('financeAccounting.form.debit') })" />
            </UFormField>
            <UFormField :label="t('financeAccounting.form.credit')" :name="`finance-line-credit-${index}`">
              <UInput v-model="line.credit" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" :aria-label="t('financeAccounting.form.lineAria', { number: index + 1, field: t('financeAccounting.form.credit') })" />
            </UFormField>
            <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" class="md:mt-6" :disabled="!hydrated || pending || draft.lines.length <= 2" :aria-label="t('financeAccounting.form.removeLine', { number: index + 1 })" @click="removeLine(index)" />
          </div>
        </li>
      </ol>
      <div class="mt-4 grid gap-4">
        <div>
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated || pending" :label="t('financeAccounting.form.addLine')" data-testid="finance-entry-add-line" @click="addLine" />
        </div>
        <UFormField name="finance-entry-balance" :error="shown && (shown.unbalanced || shown.tooFewLines) ? t(shown.tooFewLines ? 'financeAccounting.form.tooFewLines' : 'financeAccounting.form.unbalanced') : undefined">
          <dl class="grid gap-2 text-sm sm:grid-cols-3" data-testid="finance-entry-totals">
            <div class="flex items-center justify-between gap-3 sm:block">
              <dt class="text-muted">{{ t('financeAccounting.form.totalDebit') }}</dt>
              <dd class="font-semibold text-highlighted"><Money :amount="totals.debit" :currency="currency" /></dd>
            </div>
            <div class="flex items-center justify-between gap-3 sm:block">
              <dt class="text-muted">{{ t('financeAccounting.form.totalCredit') }}</dt>
              <dd class="font-semibold text-highlighted"><Money :amount="totals.credit" :currency="currency" /></dd>
            </div>
            <div class="flex items-center justify-between gap-3 sm:block">
              <dt class="text-muted">{{ t('financeAccounting.form.difference') }}</dt>
              <dd class="font-semibold" :class="balanced ? 'text-success' : 'text-warning'"><Money :amount="totals.difference" :currency="currency" /></dd>
            </div>
          </dl>
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeAccounting.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t('financeAccounting.form.createDraft')" data-testid="finance-entry-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
