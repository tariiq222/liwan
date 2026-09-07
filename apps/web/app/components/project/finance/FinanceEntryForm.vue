<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import type { FinanceEntry, FinanceKind } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, fromCalendarDate, toCalendarDate } from '@/composables/calendarDate'
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
const { t, locale } = useI18n()
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
  { immediate: true },
)

watch(
  () => props.defaultKind,
  (kind) => {
    if (props.entry || !kind || loadedEntryId.value) return
    if (draft.value.kind === kind) return
    draft.value.kind = kind
    baseline.value = snapshotFinanceDraft(draft.value)
  },
  { immediate: true },
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
const deadline = computed({
  get: () => toCalendarDate(draft.value.expenseDate),
  set: (value) => {
    draft.value.expenseDate = fromCalendarDate(value)
  },
})
const dateLabel = computed(() => draft.value.expenseDate
  ? formatCalendarDate(draft.value.expenseDate, locale.value)
  : t('projects.finance.fields.expense_date'))

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

function onCalendarChange(value: unknown) {
  deadline.value = value as CalendarDate | undefined
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
  <form data-testid="finance-form" class="nasq-form-grid" @submit.prevent="submit()">
    <SharedUnsavedChanges :dirty="dirty" />

    <div class="grid gap-2">
      <Label for="finance-kind">{{ t('projects.finance.fields.kind') }}</Label>
      <Select :model-value="draft.kind" :disabled="!hydrated || pending || isEdit" @update:model-value="onKindChange">
        <SelectTrigger id="finance-kind" class="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="budget">{{ t('projects.finance.kind.budget') }}</SelectItem>
          <SelectItem value="expense">{{ t('projects.finance.kind.expense') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="grid gap-2">
      <Label for="finance-title">{{ t('projects.finance.fields.title') }}</Label>
      <Input id="finance-title" v-model="draft.title" required :disabled="!hydrated || pending" :aria-invalid="!!fieldErrors.title" />
      <p v-if="fieldErrors.title" role="alert" class="text-sm text-destructive">{{ fieldErrors.title }}</p>
    </div>

    <div class="grid gap-2">
      <Label for="finance-amount">{{ t('projects.finance.fields.amount') }}</Label>
      <Input
        id="finance-amount"
        v-model="draft.amountInput"
        data-testid="finance-amount"
        inputmode="decimal"
        dir="ltr"
        required
        :disabled="!hydrated || pending"
        :aria-invalid="!!fieldErrors.amount"
        :aria-describedby="'finance-currency-help'"
      />
      <p id="finance-currency-help" class="text-xs text-muted-foreground">
        {{ t('projects.finance.currencyReadOnly', { name: currency.name, symbol: currency.symbol, places: decimalPlaces }) }}
      </p>
      <p v-if="fieldErrors.amount" role="alert" class="text-sm text-destructive">{{ fieldErrors.amount }}</p>
    </div>

    <template v-if="draft.kind === 'expense'">
      <div class="grid gap-2">
        <Label>{{ t('projects.finance.fields.expense_date') }}</Label>
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" type="button" class="w-full justify-start" :disabled="!hydrated || pending" :aria-invalid="!!fieldErrors.expense_date">
              {{ dateLabel }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar :model-value="deadline" @update:model-value="onCalendarChange" />
          </PopoverContent>
        </Popover>
        <p v-if="fieldErrors.expense_date" role="alert" class="text-sm text-destructive">{{ fieldErrors.expense_date }}</p>
      </div>

      <FinanceBudgetPicker
        :project-id="projectId"
        :model-value="draft.budgetEntryId"
        :disabled="!hydrated || pending"
        :selected-label="selectedBudgetTitle"
        @update:model-value="draft.budgetEntryId = $event"
      />
      <p v-if="fieldErrors.budget_entry_id" role="alert" class="text-sm text-destructive">{{ fieldErrors.budget_entry_id }}</p>
    </template>

    <div class="grid gap-2">
      <Label for="finance-reference">{{ t('projects.finance.fields.reference') }}</Label>
      <Input id="finance-reference" v-model="draft.reference" :disabled="!hydrated || pending" :aria-invalid="!!fieldErrors.reference" />
      <p v-if="fieldErrors.reference" role="alert" class="text-sm text-destructive">{{ fieldErrors.reference }}</p>
    </div>

    <div class="grid gap-2 sm:col-span-2">
      <Label for="finance-notes">{{ t('projects.finance.fields.notes') }}</Label>
      <Textarea id="finance-notes" v-model="draft.notes" :disabled="!hydrated || pending" :aria-invalid="!!fieldErrors.notes" />
      <p v-if="fieldErrors.notes" role="alert" class="text-sm text-destructive">{{ fieldErrors.notes }}</p>
    </div>

    <div v-if="stale" data-testid="finance-stale" class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm sm:col-span-2 dark:border-amber-900 dark:bg-amber-950/40">
      <p class="font-medium">{{ t('projects.finance.staleTitle') }}</p>
      <p class="mt-1 text-muted-foreground">{{ t('projects.finance.staleText') }}</p>
      <p v-if="latestEntry" class="mt-2 text-muted-foreground" data-testid="finance-stale-latest">
        {{ t('projects.finance.staleLatest', { title: latestEntry.title, amount: formatMoney(latestEntry.amount, currency), revision: latestEntry.updated_at }) }}
      </p>
      <p v-if="latestFetchFailed" role="alert" class="mt-2 text-destructive">{{ t('projects.finance.staleFetchFailed') }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button v-if="latestFetchFailed" data-testid="finance-retry-latest" type="button" variant="outline" :disabled="fetchingLatest || pending" @click="retryLatest">{{ t('app.retry') }}</Button>
        <Button type="button" variant="outline" :disabled="pending || !latestEntry || latestFetchFailed" @click="reloadFromServer">{{ t('projects.finance.reload') }}</Button>
        <Button type="button" :disabled="overwriteDisabled" @click="saveOnLatest">{{ t('projects.finance.saveOnLatest') }}</Button>
      </div>
    </div>

    <p v-if="!canWrite" role="alert" class="text-sm text-destructive sm:col-span-2">{{ t('projects.finance.writeRevoked') }}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive sm:col-span-2">{{ error }}</p>

    <div class="nasq-form-footer sm:col-span-2">
      <Button type="button" variant="outline" :disabled="pending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="ordinarySaveDisabled">{{ isEdit ? t('app.save') : t('app.create') }}</Button>
    </div>
  </form>
</template>
