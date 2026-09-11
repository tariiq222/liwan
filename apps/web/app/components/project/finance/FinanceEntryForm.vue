<script setup lang="ts">
import type { FinanceEntry, FinanceKind } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useCreateFinanceEntry, useProjectFinanceEntry, useUpdateFinanceEntry } from '@/composables/useProjectFinance'
import FinanceBudgetPicker from '@/components/project/finance/FinanceBudgetPicker.vue'
import {
  createBodyFromDraft,
  draftFromEntry,
  emptyFinanceDraft,
  financeFieldErrorKey,
  financePatchHasMutation,
  financeSubmitToken,
  formatMoney,
  isFinanceDraftDirty,
  isStaleFinanceWrite,
  patchBodyFromDraft,
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
      const created = await createEntry({ projectId: props.projectId, body: createBodyFromDraft(preserved, decimalPlaces.value) })
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
    const patch = patchBodyFromDraft(preserved, baseline.value, token, decimalPlaces.value)
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
  <form data-testid="finance-form" class="space-y-8" @submit.prevent="submit()">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection :title="t('projects.refresh.finance.formDetailsTitle')" :description="t('projects.refresh.finance.formDetailsDescription')">
      <div class="grid gap-5">
        <div class="space-y-2">
          <label for="finance-kind" class="block font-medium text-default">{{ t('projects.finance.fields.kind') }}</label>
          <USelect
            id="finance-kind"
            :model-value="draft.kind"
            :items="kindItems"
            :disabled="!hydrated || pending || isEdit"
            class="w-full"
            @update:model-value="onKindChange"
          />
        </div>
        <div class="space-y-2">
          <label for="finance-title" class="block font-medium text-default after:content-['*'] after:ms-0.5 after:text-error">{{ t('projects.finance.fields.title') }}</label>
          <UInput id="finance-title" v-model="draft.title" class="w-full" required :disabled="!hydrated || pending" :color="fieldErrors.title ? 'error' : undefined" :highlight="!!fieldErrors.title" :aria-invalid="!!fieldErrors.title" :aria-describedby="fieldErrors.title ? 'finance-title-error' : undefined" />
          <p v-if="fieldErrors.title" id="finance-title-error" role="alert" class="mt-2 text-sm text-error">{{ fieldErrors.title }}</p>
        </div>
      </div>
    </SharedFormSection>

    <SharedFormSection :title="t('projects.refresh.finance.formAmountTitle')" :description="t('projects.refresh.finance.formAmountDescription')">
      <div class="grid gap-5">
        <div class="space-y-2">
          <label for="finance-amount" class="block font-medium text-default after:content-['*'] after:ms-0.5 after:text-error">{{ t('projects.finance.fields.amount') }}</label>
          <UInput
            id="finance-amount"
            v-model="draft.amountInput"
            data-testid="finance-amount"
            class="w-full"
            inputmode="decimal"
            dir="ltr"
            required
            :disabled="!hydrated || pending"
            :color="fieldErrors.amount ? 'error' : undefined"
            :highlight="!!fieldErrors.amount"
            :aria-invalid="!!fieldErrors.amount"
            :aria-describedby="fieldErrors.amount ? 'finance-amount-help finance-amount-error' : 'finance-amount-help'"
          />
          <p id="finance-amount-help" class="mt-2 text-sm text-muted">{{ currencyHelp }}</p>
          <p v-if="fieldErrors.amount" id="finance-amount-error" role="alert" class="mt-2 text-sm text-error">{{ fieldErrors.amount }}</p>
        </div>
        <template v-if="draft.kind === 'expense'">
          <div class="space-y-2">
            <label for="finance-expense-date" class="block font-medium text-default">{{ t('projects.finance.fields.expense_date') }}</label>
            <SharedDateField
              id="finance-expense-date"
              v-model="draft.expenseDate"
              :disabled="!hydrated || pending"
              :class="fieldErrors.expense_date ? 'ring-2 ring-error' : undefined"
              :aria-label="t('projects.finance.fields.expense_date')"
              :aria-invalid="!!fieldErrors.expense_date"
              :aria-describedby="fieldErrors.expense_date ? 'finance-expense-date-error' : undefined"
            />
            <p v-if="fieldErrors.expense_date" id="finance-expense-date-error" role="alert" class="mt-2 text-sm text-error">{{ fieldErrors.expense_date }}</p>
          </div>
          <FinanceBudgetPicker :project-id="projectId" :model-value="draft.budgetEntryId" :disabled="!hydrated || pending" :selected-label="selectedBudgetTitle" :error="fieldErrors.budget_entry_id" @update:model-value="draft.budgetEntryId = $event" />
        </template>
      </div>
    </SharedFormSection>

    <SharedFormSection :title="t('projects.refresh.finance.formReferenceTitle')" :description="t('projects.refresh.finance.formReferenceDescription')">
      <div class="grid gap-5">
        <div class="space-y-2">
          <label for="finance-reference" class="block font-medium text-default">{{ t('projects.finance.fields.reference') }}</label>
          <UInput id="finance-reference" v-model="draft.reference" class="w-full" :disabled="!hydrated || pending" :color="fieldErrors.reference ? 'error' : undefined" :highlight="!!fieldErrors.reference" :aria-invalid="!!fieldErrors.reference" :aria-describedby="fieldErrors.reference ? 'finance-reference-error' : undefined" />
          <p v-if="fieldErrors.reference" id="finance-reference-error" role="alert" class="mt-2 text-sm text-error">{{ fieldErrors.reference }}</p>
        </div>
        <div class="space-y-2 sm:col-span-2">
          <label for="finance-notes" class="block font-medium text-default">{{ t('projects.finance.fields.notes') }}</label>
          <UTextarea id="finance-notes" v-model="draft.notes" class="w-full" :disabled="!hydrated || pending" :color="fieldErrors.notes ? 'error' : undefined" :highlight="!!fieldErrors.notes" :aria-invalid="!!fieldErrors.notes" :aria-describedby="fieldErrors.notes ? 'finance-notes-error' : undefined" />
          <p v-if="fieldErrors.notes" id="finance-notes-error" role="alert" class="mt-2 text-sm text-error">{{ fieldErrors.notes }}</p>
        </div>
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
        <UButton v-if="latestFetchFailed" data-testid="finance-retry-latest" type="button" color="secondary" :disabled="fetchingLatest || pending" @click="retryLatest" variant="solid">{{ t('app.retry') }}</UButton>
        <UButton type="button" color="secondary" :disabled="pending || !latestEntry || latestFetchFailed" @click="reloadFromServer" variant="solid">{{ t('projects.finance.reload') }}</UButton>
        <UButton type="button" :disabled="overwriteDisabled" @click="saveOnLatest">{{ t('projects.finance.saveOnLatest') }}</UButton>
      </template>
    </UAlert>

    <UAlert v-if="!canWrite" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('projects.finance.writeRevoked')" />
    <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

    <div class="flex flex-wrap gap-2 justify-end">
      <UButton type="button" color="secondary" :disabled="pending" @click="emit('cancel')" variant="solid">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :disabled="ordinarySaveDisabled">{{ isEdit ? t('app.save') : t('app.create') }}</UButton>
    </div>
  </form>
</template>
