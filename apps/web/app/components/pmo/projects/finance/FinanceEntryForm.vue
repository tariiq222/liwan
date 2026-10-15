<script setup lang="ts">
import type { FinanceEntry, FinanceKind } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useCreateFinanceEntry, useProjectFinanceEntry, useUpdateFinanceEntry } from '@/composables/useProjectFinance'
import FinanceBudgetPicker from '@/components/pmo/projects/finance/FinanceBudgetPicker.vue'
import {
  financeCreateBody,
  draftFromEntry,
  emptyFinanceDraft,
  financeFieldErrorKey,
  financePatchHasMutation,
  financeSubmitToken,
  formatMoney,
  isFinanceDraftDirty,
  isStaleFinanceWrite,
  financePatchBody,
  snapshotFinanceDraft,
  validateFinanceDraft,
  type FinanceCurrency,
  type FinanceDraft,
  type FinanceFieldKey,
} from '@/utils/projectFinance'

const props = defineProps<{
  projectId: number
  currency: FinanceCurrency
  entry?: FinanceEntry | null
  defaultKind?: FinanceKind
  selectedBudgetTitle?: string | null
  writeAllowed?: boolean
}>()
const emit = defineEmits<{ saved: [entry: FinanceEntry]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createEntry, isPending: creating } = useCreateFinanceEntry()
const { mutateAsync: updateEntry, isPending: updating } = useUpdateFinanceEntry()
const isEdit = computed(() => !!props.entry)
const decimalPlaces = computed(() => props.currency.decimal_places)
const draft = ref<FinanceDraft>(emptyFinanceDraft(props.defaultKind ?? 'budget'))
const baseline = ref<FinanceDraft>(snapshotFinanceDraft(draft.value))
const writeToken = ref<string | null>(props.entry?.updated_at ?? null)
const latestToken = ref<string | null>(null)
const latestEntry = ref<FinanceEntry | null>(null)
const latestFetchFailed = ref(false)
const fetchingLatest = ref(false)
const fieldErrors = ref<Partial<Record<FinanceFieldKey, string>>>({})
const error = ref<string | null>(null)
const stale = ref(false)
const submitted = ref(false)
const loadedEntryId = ref<number | null>(null)
const canWrite = computed(() => props.writeAllowed !== false)
const entryQuery = useProjectFinanceEntry(
  computed(() => props.projectId),
  computed(() => stale.value ? props.entry?.id ?? null : null),
)
const kindItems = computed(() => [
  { value: 'budget', label: t('projects.finance.kind.budget') },
  { value: 'expense', label: t('projects.finance.kind.expense') },
])
const currencyHelp = computed(() => t('projects.finance.currencyReadOnly', {
  name: props.currency.name,
  symbol: props.currency.symbol,
  places: decimalPlaces.value,
}))

function applyEntry(record: FinanceEntry) {
  const next = draftFromEntry(record, decimalPlaces.value)
  draft.value = next
  baseline.value = snapshotFinanceDraft(next)
  writeToken.value = record.updated_at
  latestToken.value = null
  latestEntry.value = null
  latestFetchFailed.value = false
  submitted.value = false
}

watch(
  () => props.entry?.id,
  (id) => {
    if (!props.entry || !id || loadedEntryId.value === id) return
    applyEntry(props.entry)
    loadedEntryId.value = id
  },
  { immediate: true, flush: 'sync' },
)

watch(
  () => props.defaultKind,
  (kind) => {
    if (props.entry || !kind || loadedEntryId.value) return
    if (draft.value.kind === kind) return
    draft.value.kind = kind
    baseline.value = snapshotFinanceDraft(draft.value)
  },
  { immediate: true, flush: 'sync' },
)

const pending = computed(() => creating.value || updating.value)
const dirty = computed(() => !submitted.value && isFinanceDraftDirty(draft.value, baseline.value, decimalPlaces.value))
const ordinarySaveDisabled = computed(() => !hydrated.value || pending.value || stale.value || !canWrite.value || (isEdit.value && !dirty.value))
const overwriteDisabled = computed(() => !hydrated.value || pending.value || fetchingLatest.value || !canWrite.value || !financeSubmitToken({
  stale: stale.value,
  overwrite: true,
  writeToken: writeToken.value,
  latestToken: latestToken.value,
  latestFetchFailed: latestFetchFailed.value,
}))

function errorMessage(code: string, field?: string): string {
  const key = `projects.finance.errors.${code}`
  const translated = t(key)
  if (translated !== key) return translated
  if (field) return `${t(financeFieldErrorKey(field))}: ${code}`
  return t('errors.generic')
}

function applyValidation(): boolean {
  fieldErrors.value = {}
  const errors = validateFinanceDraft(draft.value, decimalPlaces.value)
  for (const item of errors) fieldErrors.value[item.field] = errorMessage(item.code, item.field)
  return errors.length === 0
}

function onKindChange(value: unknown) {
  if (isEdit.value) return
  draft.value.kind = value === 'expense' ? 'expense' : 'budget'
}

async function submit(options: { overwrite?: boolean } = {}) {
  error.value = null
  if (!hydrated.value || pending.value || !canWrite.value) return
  if (stale.value && !options.overwrite) return
  if (!applyValidation()) return
  const preserved = snapshotFinanceDraft(draft.value)
  try {
    if (!isEdit.value) {
      const created = await createEntry({ projectId: props.projectId, body: financeCreateBody(preserved, decimalPlaces.value) })
      submitted.value = true
      emit('saved', created)
      return
    }
    const token = financeSubmitToken({
      stale: stale.value,
      overwrite: !!options.overwrite,
      writeToken: writeToken.value,
      latestToken: latestToken.value,
      latestFetchFailed: latestFetchFailed.value,
    })
    if (!props.entry || !token) return
    const patch = financePatchBody(preserved, baseline.value, token, decimalPlaces.value)
    if (!financePatchHasMutation(patch)) return
    const updated = await updateEntry({ projectId: props.projectId, entryId: props.entry.id, patch })
    applyEntry(updated)
    stale.value = false
    emit('saved', updated)
  }
  catch (e) {
    draft.value = preserved
    if (isStaleFinanceWrite(e)) {
      stale.value = true
      error.value = null
      await retryLatest()
      return
    }
    if (e instanceof ApiError && e.field) {
      const field = e.field as FinanceFieldKey
      fieldErrors.value[field] = e.message || errorMessage(e.code, e.field)
      error.value = null
      return
    }
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}

async function retryLatest() {
  if (fetchingLatest.value) return
  fetchingLatest.value = true
  latestToken.value = null
  latestEntry.value = null
  try {
    const result = await entryQuery.refetch()
    if (!result.error && result.data) {
      latestToken.value = result.data.updated_at
      latestEntry.value = result.data
      latestFetchFailed.value = false
    }
    else {
      latestFetchFailed.value = true
    }
  }
  catch {
    latestFetchFailed.value = true
  }
  finally {
    fetchingLatest.value = false
  }
}

function reloadFromServer() {
  const latest = latestEntry.value
  if (!latest || latestFetchFailed.value) return
  applyEntry(latest)
  stale.value = false
  error.value = null
  fieldErrors.value = {}
}

async function saveOnLatest() {
  await submit({ overwrite: true })
}
</script>

<template>
  <form data-testid="finance-form" class="space-y-8" novalidate @submit.prevent="submit()">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="!canWrite" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('projects.finance.writeRevoked')" />
    <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <SharedFormSection :title="t('projects.refresh.finance.formDetailsTitle')" :description="t('projects.refresh.finance.formDetailsDescription')">
      <div class="grid gap-5">
        <UFormField name="kind" :label="t('projects.finance.fields.kind')">
          <USelect
            id="finance-kind"
            :model-value="draft.kind"
            :items="kindItems"
            :disabled="!hydrated || pending || isEdit"
            class="w-full"
            @update:model-value="onKindChange"
          />
        </UFormField>
        <UFormField name="title" :label="t('projects.finance.fields.title')" required :error="fieldErrors.title">
          <UInput id="finance-title" v-model="draft.title" class="w-full" required :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection :title="t('projects.refresh.finance.formAmountTitle')" :description="t('projects.refresh.finance.formAmountDescription')">
      <div class="grid gap-5">
        <UFormField name="amount" :label="t('projects.finance.fields.amount')" required :help="currencyHelp" :error="fieldErrors.amount">
          <UInput
            id="finance-amount"
            v-model="draft.amountInput"
            data-testid="finance-amount"
            class="w-full"
            inputmode="decimal"
            dir="ltr"
            required
            :disabled="!hydrated || pending"
          />
        </UFormField>
        <template v-if="draft.kind === 'expense'">
          <UFormField name="expense_date" :label="t('projects.finance.fields.expense_date')" required :error="fieldErrors.expense_date">
            <SharedDateField
              id="finance-expense-date"
              v-model="draft.expenseDate"
              :disabled="!hydrated || pending"
              :aria-label="t('projects.finance.fields.expense_date')"
            />
          </UFormField>
          <FinanceBudgetPicker :project-id="projectId" :model-value="draft.budgetEntryId" :disabled="!hydrated || pending" :selected-label="selectedBudgetTitle" :error="fieldErrors.budget_entry_id" @update:model-value="draft.budgetEntryId = $event" />
        </template>
      </div>
    </SharedFormSection>

    <SharedFormSection :title="t('projects.refresh.finance.formReferenceTitle')" :description="t('projects.refresh.finance.formReferenceDescription')">
      <div class="grid gap-5">
        <UFormField name="reference" :label="t('projects.finance.fields.reference')" :error="fieldErrors.reference">
          <UInput id="finance-reference" v-model="draft.reference" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField name="notes" :label="t('projects.finance.fields.notes')" :error="fieldErrors.notes" class="sm:col-span-2">
          <UTextarea id="finance-notes" v-model="draft.notes" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <UAlert
      v-if="stale"
      data-testid="finance-stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('projects.finance.staleTitle')"
    >
      <template #description>
        <p>{{ t('projects.finance.staleText') }}</p>
        <p v-if="latestEntry" class="mt-2" data-testid="finance-stale-latest">
          {{ t('projects.finance.staleLatest', { title: latestEntry.title, amount: formatMoney(latestEntry.amount, currency), revision: latestEntry.updated_at }) }}
        </p>
        <p v-if="latestFetchFailed" role="alert" class="mt-2">{{ t('projects.finance.staleFetchFailed') }}</p>
      </template>
      <template #actions>
        <UButton v-if="latestFetchFailed" data-testid="finance-retry-latest" type="button" color="neutral" :disabled="fetchingLatest || pending" @click="retryLatest" variant="outline">{{ t('app.retry') }}</UButton>
        <UButton type="button" color="neutral" :disabled="pending || !latestEntry || latestFetchFailed" @click="reloadFromServer" variant="outline">{{ t('projects.finance.reload') }}</UButton>
        <UButton type="button" :disabled="overwriteDisabled" @click="saveOnLatest">{{ t('projects.finance.saveOnLatest') }}</UButton>
      </template>
    </UAlert>

    <SharedFormActions class="flex flex-wrap gap-2 justify-end">
      <UButton type="button" color="neutral" :disabled="pending" @click="emit('cancel')" variant="outline">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :loading="pending" :disabled="ordinarySaveDisabled">{{ isEdit ? t('app.save') : t('app.create') }}</UButton>
    </SharedFormActions>
  </form>
</template>
