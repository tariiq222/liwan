<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { FinanceBankImportColumns, FinanceBankImportPreview } from '@webvue/contracts'
import {
  useFinanceBankImportColumns,
  useFinanceBankImportPreview,
  useFinanceBankJournals,
  useImportFinanceBankStatement,
} from '@/composables/finance/useFinanceBank'
import { financeErrorMessage } from '../financeErrors'
import { formatAmount } from '../invoices/formatAmount'
import Money from '../invoices/Money.vue'
import { bankErrorKey } from './bankErrors'
import {
  IMPORT_DATE_FORMATS,
  IMPORT_DELIMITERS,
  IMPORT_MAPPING_FIELDS,
  IMPORT_MAX_BYTES,
  applySuggestedMapping,
  closingMatches,
  emptyImportDraft,
  expectedClosing,
  importBody,
  importFileBody,
  importMapping,
  type BankImportDraft,
} from './bankImportModel'

// Imports a CSV statement in three steps that write nothing until the last: read the file's columns, map them and
// preview every line the import would create (duplicates and unreadable rows are shown), then give the balances the
// bank printed. The server refuses the import unless opening balance + lines = closing balance.
defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const journals = useFinanceBankJournals()
const columnsCall = useFinanceBankImportColumns()
const previewCall = useFinanceBankImportPreview()
const importCall = useImportFinanceBankStatement()

const draft = reactive<BankImportDraft>(emptyImportDraft())
const columns = ref<FinanceBankImportColumns | null>(null)
const preview = ref<FinanceBankImportPreview | null>(null)
const error = ref('')
const saved = ref(false)
const journalItems = computed(() => (journals.data.value?.items ?? []).map(journal => ({ value: journal.id, label: `${journal.name} (${journal.currency})` })))
watch(journalItems, rows => { if (draft.journalId === null && rows.length) draft.journalId = rows[0]!.value }, { immediate: true })
const currency = computed(() => journals.data.value?.items.find(journal => journal.id === draft.journalId)?.currency)
const columnItems = computed(() => [{ value: '', label: t('financeBank.import.notMapped') }, ...(columns.value?.columns ?? []).map((name, index) => ({ value: draft.hasHeader ? name : String(index), label: name }))])
const delimiterItems = [{ value: '', label: t('financeBank.import.autoDelimiter') }, ...IMPORT_DELIMITERS.map(value => ({ value, label: t(`financeBank.import.delimiters.${value === '\t' ? 'tab' : value}`) }))]
const dateItems = IMPORT_DATE_FORMATS.map(value => ({ value, label: value }))
const decimalItems = [{ value: '.', label: '1234.56' }, { value: ',', label: '1234,56' }]
const mappingReady = computed(() => !!importMapping(draft))
const body = computed(() => importBody(draft))
const matches = computed(() => !!preview.value && closingMatches(draft, preview.value))
const expected = computed(() => preview.value ? expectedClosing(draft.balanceStart, preview.value) : null)
const pending = computed(() => columnsCall.isPending.value || previewCall.isPending.value || importCall.isPending.value)
const dirty = computed(() => !saved.value && !!draft.content)

// Changing how the file is read invalidates what was previewed from it.
function reset() { columns.value = null; preview.value = null }
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  error.value = ''
  reset()
  if (!file) return
  if (file.size > IMPORT_MAX_BYTES) { error.value = t('financeBank.import.tooLarge'); return }
  draft.fileName = file.name
  draft.content = await file.text()
}
async function readColumns() {
  if (!hydrated.value || pending.value || !draft.content || !draft.journalId) return
  error.value = ''
  preview.value = null
  try {
    columns.value = await columnsCall.mutateAsync(importFileBody(draft))
    applySuggestedMapping(draft, columns.value.suggested_mapping)
  } catch (cause) {
    error.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
async function runPreview() {
  const mapping = importMapping(draft)
  if (!hydrated.value || pending.value || !mapping) return
  error.value = ''
  try {
    preview.value = await previewCall.mutateAsync({ ...importFileBody(draft), mapping })
  } catch (cause) {
    error.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
async function submit() {
  if (!hydrated.value || pending.value || !body.value || !preview.value || !matches.value) return
  error.value = ''
  try {
    const record = await importCall.mutateAsync(body.value)
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
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-bank-import-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-bank-import-error" />

    <SharedFormSection panel :title="t('financeBank.import.fileSection')">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('financeBank.form.journal')" name="finance-bank-import-journal" required class="sm:col-span-2">
          <SharedPageState :loading="journals.isLoading.value" :error="journals.error.value" :empty="!journals.isLoading.value && !journalItems.length" :empty-text="t('financeBank.form.noJournals')" @retry="journals.refetch">
            <USelect id="finance-bank-import-journal" :model-value="draft.journalId ?? undefined" :items="journalItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="value => { draft.journalId = Number(value); reset() }" />
          </SharedPageState>
        </UFormField>
        <UFormField :label="t('financeBank.import.file')" name="finance-bank-import-file" required :hint="t('financeBank.import.fileHint')" class="sm:col-span-2">
          <input id="finance-bank-import-file" type="file" accept=".csv,.txt,text/csv" class="block w-full text-sm" :disabled="!hydrated || pending" data-testid="finance-bank-import-file" @change="chooseFile">
        </UFormField>
        <UFormField :label="t('financeBank.import.delimiter')" name="finance-bank-import-delimiter">
          <USelect id="finance-bank-import-delimiter" v-model="draft.delimiter" :items="delimiterItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="reset" />
        </UFormField>
        <UFormField :label="t('financeBank.import.dateFormat')" name="finance-bank-import-date-format">
          <USelect id="finance-bank-import-date-format" v-model="draft.dateFormat" :items="dateItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="preview = null" />
        </UFormField>
        <UFormField :label="t('financeBank.import.decimal')" name="finance-bank-import-decimal">
          <USelect id="finance-bank-import-decimal" v-model="draft.decimalSeparator" :items="decimalItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="preview = null" />
        </UFormField>
        <UFormField name="finance-bank-import-header">
          <UCheckbox v-model="draft.hasHeader" :label="t('financeBank.import.hasHeader')" :disabled="!hydrated || pending" @update:model-value="reset" />
        </UFormField>
        <div class="sm:col-span-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || !draft.content || !draft.journalId" :loading="columnsCall.isPending.value" :label="t('financeBank.import.readColumns')" data-testid="finance-bank-import-read" @click="readColumns" />
        </div>
      </div>
    </SharedFormSection>

    <SharedFormSection v-if="columns" panel :title="t('financeBank.import.mappingSection')">
      <div class="grid gap-4 sm:grid-cols-2">
        <p class="text-sm text-muted sm:col-span-2">{{ t('financeBank.import.rowCount', { count: columns.row_count }, columns.row_count) }}</p>
        <UFormField v-for="field in IMPORT_MAPPING_FIELDS" :key="field" :label="t(`financeBank.import.fields.${field}`)" :name="`finance-bank-import-map-${field}`" :required="field === 'date' || field === 'payment_ref'">
          <USelect :id="`finance-bank-import-map-${field}`" v-model="draft.mapping[field]" :items="columnItems" class="w-full" :disabled="!hydrated || pending" @update:model-value="preview = null" />
        </UFormField>
        <p v-if="!mappingReady" class="text-sm text-muted sm:col-span-2">{{ t('financeBank.import.mappingHint') }}</p>
        <div class="sm:col-span-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || !mappingReady" :loading="previewCall.isPending.value" :label="t('financeBank.import.previewAction')" data-testid="finance-bank-import-preview" @click="runPreview" />
        </div>
      </div>
    </SharedFormSection>

    <SharedFormSection v-if="preview" panel :title="t('financeBank.import.previewSection')">
      <div class="grid gap-4">
        <p class="text-sm" data-testid="finance-bank-import-summary">
          {{ t('financeBank.import.summary', { lines: preview.summary.lines, duplicates: preview.summary.duplicates, from: preview.summary.date_from ?? '—', to: preview.summary.date_to ?? '—' }) }}
          · <Money :amount="preview.summary.total" :currency="currency" />
        </p>
        <UAlert v-if="preview.errors.length" role="alert" color="warning" variant="subtle" :title="t('financeBank.import.rowErrors', { count: preview.errors.length }, preview.errors.length)">
          <template #description>
            <ul class="list-disc ps-5">
              <li v-for="problem in preview.errors.slice(0, 10)" :key="`${problem.row}-${problem.field}`">{{ t('financeBank.import.rowError', { row: problem.row, field: t(`financeBank.import.fields.${problem.field}`), message: problem.message }) }}</li>
            </ul>
          </template>
        </UAlert>
        <div class="max-h-80 overflow-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">{{ t('financeBank.import.previewSection') }}</caption>
            <thead><tr class="text-start text-muted"><th scope="col" class="p-1 text-start">#</th><th scope="col" class="p-1 text-start">{{ t('financeBank.columns.date') }}</th><th scope="col" class="p-1 text-start">{{ t('financeBank.columns.label') }}</th><th scope="col" class="p-1 text-end">{{ t('financeBank.columns.amount') }}</th><th scope="col" class="p-1" /></tr></thead>
            <tbody>
              <tr v-for="line in preview.lines.slice(0, 200)" :key="line.row" :class="line.duplicate ? 'text-muted' : ''">
                <td class="p-1 tabular-nums">{{ line.row }}</td>
                <td class="p-1"><bdi class="tabular-nums">{{ line.date }}</bdi></td>
                <td class="p-1">{{ line.payment_ref }}</td>
                <td class="p-1 text-end"><Money :amount="line.amount" :currency="currency" /></td>
                <td class="p-1"><SharedStatusBadge v-if="line.duplicate" size="sm" tone="warning" :label="t('financeBank.import.duplicate')" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <UCheckbox v-if="preview.summary.duplicates" v-model="draft.skipDuplicates" :label="t('financeBank.import.skipDuplicates')" :disabled="!hydrated || pending" />
      </div>
    </SharedFormSection>

    <SharedFormSection v-if="preview" panel :title="t('financeBank.form.balances')">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('financeBank.form.name')" name="finance-bank-import-name" class="sm:col-span-2"><UInput id="finance-bank-import-name" v-model="draft.name" class="w-full" maxlength="120" :disabled="!hydrated || pending" /></UFormField>
        <UFormField :label="t('financeBank.form.balanceStart')" name="finance-bank-import-start" required><UInput id="finance-bank-import-start" v-model="draft.balanceStart" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" /></UFormField>
        <UFormField :label="t('financeBank.form.balanceEndReal')" name="finance-bank-import-end" required><UInput id="finance-bank-import-end" v-model="draft.balanceEnd" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" /></UFormField>
        <p v-if="expected !== null && draft.balanceEnd.trim() !== '' && !matches" class="text-sm text-warning sm:col-span-2" role="alert" data-testid="finance-bank-import-mismatch">
          {{ t('financeBank.import.mismatch', { expected: formatAmount(expected) }) }}
        </p>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeDocuments.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || !preview || !body || !matches || pending" :loading="importCall.isPending.value" :label="t('financeBank.import.submit')" data-testid="finance-bank-import-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
