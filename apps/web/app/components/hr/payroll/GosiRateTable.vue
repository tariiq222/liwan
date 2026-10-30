<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import {
  HR_GOSI_BRANCHES,
  HR_GOSI_NATIONALITY_CLASSES,
  HrGosiRatePatchSchema,
  HrGosiRateWriteSchema,
  type HrGosiRate,
  type HrGosiRateWrite,
} from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { gosiRatePatch } from '@/utils/payrollSettings'
import { payrollFieldError } from '@/utils/payrollErrors'
import { parseMoneyInput } from '@/utils/moneyInput'
import { formatPayrollAmount, formatPayrollPercent } from '@/utils/payrollFormat'

// The GOSI contribution rates of the company: one row per branch, nationality class and start date. A shared row (the
// platform's default) is read-only; a company row is edited in a form that opens above the table and deleted after an
// inline confirmation. The component owns its writes and shows the server's refusal beside the field. An edit or a
// delete sends the revision of the row it opened; a 409 keeps the draft until the user reloads the latest row.
const props = defineProps<{
  rates: HrGosiRate[]
  canEdit: boolean
  reloadRates: () => Promise<HrGosiRate[]>
}>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending: saving } = useSaveHrGosiRate()
const { mutateAsync: remove, isPending: removing } = useDeleteHrGosiRate()

const NUMBER_FIELDS = ['employee_rate', 'employer_rate', 'wage_min', 'wage_max'] as const
type NumberField = typeof NUMBER_FIELDS[number]

const editing = ref<'new' | HrGosiRate | null>(null)
const deleting = ref<HrGosiRate | null>(null)
const branch = ref<HrGosiRate['branch']>(HR_GOSI_BRANCHES[0])
const nationalityClass = ref<HrGosiRate['nationality_class']>(HR_GOSI_NATIONALITY_CLASSES[0])
const dateFrom = ref<string | null>(null)
const numbers = reactive<Record<NumberField, string>>({ employee_rate: '', employer_rate: '', wage_min: '', wage_max: '' })
const attempted = ref(false)
// After a reload the row that changed becomes the baseline again (or the form closes when it was deleted).
const { failure, conflict, reloading, reloadFailure, reload } = usePayrollConflict(() => props.reloadRates(), (rates) => {
  const fresh = (rate: HrGosiRate) => rates.find(row => row.id === rate.id) ?? null
  if (deleting.value) deleting.value = fresh(deleting.value)
  const target = editing.value
  if (target && target !== 'new') {
    const row = fresh(target)
    if (row) open(row)
    else close()
  }
})

const branchOptions = computed(() => HR_GOSI_BRANCHES.map(value => ({ value, label: t(`hrPayroll.gosi.branch.${value}`) })))
const classOptions = computed(() => HR_GOSI_NATIONALITY_CLASSES.map(value => ({ value, label: t(`hrPayroll.gosi.class.${value}`) })))

function open(target: 'new' | HrGosiRate) {
  editing.value = target
  deleting.value = null
  attempted.value = false
  failure.value = null
  const rate = target === 'new' ? null : target
  branch.value = rate?.branch ?? HR_GOSI_BRANCHES[0]
  nationalityClass.value = rate?.nationality_class ?? HR_GOSI_NATIONALITY_CLASSES[0]
  dateFrom.value = rate?.date_from ?? null
  for (const field of NUMBER_FIELDS) numbers[field] = rate ? String(rate[field]) : ''
}
function close() {
  editing.value = null
  failure.value = null
}
function askDelete(rate: HrGosiRate | null) {
  deleting.value = rate
  editing.value = null
  failure.value = null
}

const parsedNumbers = computed(() => Object.fromEntries(NUMBER_FIELDS.map((field) => {
  const parsed = parseMoneyInput(numbers[field], 2)
  return [field, parsed.ok ? parsed.value : Number.NaN]
})))
const body = computed(() => ({
  branch: branch.value,
  nationality_class: nationalityClass.value,
  date_from: dateFrom.value,
  ...parsedNumbers.value,
}))
const parsed = computed(() => HrGosiRateWriteSchema.safeParse(body.value))
const invalidFields = computed(() => new Set(parsed.value.success ? [] : parsed.value.error.issues.map(issue => String(issue.path[0]))))
const serverField = computed(() => failure.value instanceof ApiError ? failure.value.field : undefined)
function fieldError(field: string) {
  if (attempted.value && invalidFields.value.has(field)) return t('hrPayroll.gosi.fieldInvalid')
  return payrollFieldError(failure.value, t, field)
}
const failureMessage = computed(() => {
  if (conflict.value) return t('hrPayroll.revision.conflict')
  return failure.value ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain')) : undefined
})
const formAlert = computed(() => serverField.value ? undefined : failureMessage.value)
const busy = computed(() => !hydrated.value || saving.value || reloading.value || conflict.value)

async function submit() {
  if (busy.value || !editing.value) return
  attempted.value = true
  failure.value = null
  if (!parsed.value.success) return
  const target = editing.value
  try {
    if (target === 'new') await save({ body: parsed.value.data })
    else {
      const patch = gosiRatePatch(target, parsed.value.data)
      if (Object.keys(patch).length === 0) { close(); return }
      await save({ id: target.id, body: HrGosiRatePatchSchema.parse({ ...patch, revision: target.revision }) })
    }
    close()
  } catch (error) { failure.value = error }
}

async function confirmDelete() {
  if (!hydrated.value || removing.value || reloading.value || conflict.value || !deleting.value) return
  failure.value = null
  try {
    await remove({ id: deleting.value.id, revision: deleting.value.revision })
    deleting.value = null
  } catch (error) { failure.value = error }
}

const columns = computed<TableColumn<HrGosiRate>[]>(() => [
  { id: 'branch', header: t('hrPayroll.gosi.columns.branch') },
  { id: 'nationality_class', header: t('hrPayroll.gosi.columns.nationalityClass') },
  { accessorKey: 'date_from', header: t('hrPayroll.gosi.columns.dateFrom') },
  { id: 'employee_rate', header: t('hrPayroll.gosi.columns.employeeRate') },
  { id: 'employer_rate', header: t('hrPayroll.gosi.columns.employerRate') },
  { id: 'wage', header: t('hrPayroll.gosi.columns.wageRange') },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
])
const percent = (value: number) => formatPayrollPercent(value, locale.value)
const wage = (value: number) => formatPayrollAmount(value, locale.value)
const rowActions = (rate: HrGosiRate) => [
  { label: t('app.edit'), icon: 'i-lucide-pencil' as const, onSelect: () => open(rate) },
  { label: t('hrPayroll.gosi.delete'), icon: 'i-lucide-trash-2' as const, destructive: true, onSelect: () => askDelete(rate) },
]
const rateLabel = (rate: HrGosiRate) => `${t(`hrPayroll.gosi.branch.${rate.branch}`)} · ${t(`hrPayroll.gosi.class.${rate.nationality_class}`)}`
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('hrPayroll.gosi.title')" :description="t('hrPayroll.gosi.hint')">
    <template v-if="props.canEdit" #actions>
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!hydrated" :label="t('hrPayroll.gosi.add')" data-testid="hr-gosi-add" @click="open('new')" />
    </template>

    <UAlert v-if="deleting && failureMessage" role="alert" color="error" variant="subtle" :title="failureMessage" />
    <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrPayroll.revision.reload')" :loading="reloading" :disabled="!hydrated || reloading" data-testid="hr-gosi-reload" @click="reload" />
    <UAlert v-if="reloadFailure" role="alert" color="error" variant="subtle" :title="t('hrPayroll.revision.reloadError')" />
    <SharedInlineConfirm
      v-if="deleting"
      :title="t('hrPayroll.gosi.deleteTitle', { rate: rateLabel(deleting) })"
      :description="t('hrPayroll.gosi.deleteHint')"
      :confirm-label="t('hrPayroll.gosi.delete')"
      :pending="removing"
      :disabled="removing || reloading || conflict"
      @confirm="confirmDelete"
      @cancel="askDelete(null)"
    />

    <UForm v-if="editing" novalidate :state="{ branch, nationalityClass, dateFrom, ...numbers }" class="liwan-form" method="post" data-testid="hr-gosi-form" @submit="submit">
      <UAlert v-if="formAlert" role="alert" color="error" variant="subtle" :title="t('hrPayroll.gosi.saveError')" :description="formAlert" />
      <SharedFormSection :title="editing === 'new' ? t('hrPayroll.gosi.new') : t('hrPayroll.gosi.edit')">
        <div class="liwan-form-grid">
          <UFormField :label="t('hrPayroll.gosi.columns.branch')" name="hr-gosi-branch" :error="fieldError('branch')">
            <USelect id="hr-gosi-branch" v-model="branch" class="w-full" :items="branchOptions" :disabled="!hydrated || saving || reloading" data-testid="hr-gosi-branch" />
          </UFormField>
          <UFormField :label="t('hrPayroll.gosi.columns.nationalityClass')" name="hr-gosi-class" :error="fieldError('nationality_class')">
            <USelect id="hr-gosi-class" v-model="nationalityClass" class="w-full" :items="classOptions" :disabled="!hydrated || saving || reloading" data-testid="hr-gosi-class" />
          </UFormField>
          <UFormField :label="t('hrPayroll.gosi.columns.dateFrom')" name="hr-gosi-date" required :error="fieldError('date_from')">
            <SharedDateField id="hr-gosi-date" v-model="dateFrom" :disabled="!hydrated || saving || reloading" />
          </UFormField>
          <UFormField :label="t('hrPayroll.gosi.columns.employeeRate')" name="hr-gosi-employee-rate" required :error="fieldError('employee_rate')">
            <UInput id="hr-gosi-employee-rate" v-model="numbers.employee_rate" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || saving || reloading" data-testid="hr-gosi-employee-rate" />
          </UFormField>
          <UFormField :label="t('hrPayroll.gosi.columns.employerRate')" name="hr-gosi-employer-rate" required :error="fieldError('employer_rate')">
            <UInput id="hr-gosi-employer-rate" v-model="numbers.employer_rate" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || saving || reloading" data-testid="hr-gosi-employer-rate" />
          </UFormField>
          <UFormField :label="t('hrPayroll.gosi.wageMin')" name="hr-gosi-wage-min" required :error="fieldError('wage_min')">
            <UInput id="hr-gosi-wage-min" v-model="numbers.wage_min" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || saving || reloading" data-testid="hr-gosi-wage-min" />
          </UFormField>
          <UFormField :label="t('hrPayroll.gosi.wageMax')" name="hr-gosi-wage-max" required :error="fieldError('wage_max')">
            <UInput id="hr-gosi-wage-max" v-model="numbers.wage_max" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || saving || reloading" data-testid="hr-gosi-wage-max" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormActions>
        <UButton type="button" color="neutral" variant="outline" :disabled="saving" :label="t('app.cancel')" @click="close" />
        <UButton type="submit" color="primary" :disabled="busy" :loading="saving" :label="t('app.saveChanges')" data-testid="hr-gosi-submit" />
      </SharedFormActions>
    </UForm>

    <SharedEmptyState v-if="props.rates.length === 0" compact :title="t('hrPayroll.gosi.empty')" :description="t('hrPayroll.gosi.emptyHint')" />
    <SharedDataTable v-else bare :rows="props.rates" :columns="columns" row-key="id" :caption="t('hrPayroll.gosi.title')">
      <template #branch-cell="{ row }">{{ t(`hrPayroll.gosi.branch.${row.original.branch}`) }}</template>
      <template #nationality_class-cell="{ row }">{{ t(`hrPayroll.gosi.class.${row.original.nationality_class}`) }}</template>
      <template #date_from-cell="{ row }"><span class="tabular-nums">{{ formatDate(row.original.date_from) }}</span></template>
      <template #employee_rate-cell="{ row }"><span class="tabular-nums">{{ percent(row.original.employee_rate) }}</span></template>
      <template #employer_rate-cell="{ row }"><span class="tabular-nums">{{ percent(row.original.employer_rate) }}</span></template>
      <template #wage-cell="{ row }"><span class="tabular-nums">{{ wage(row.original.wage_min) }} – {{ wage(row.original.wage_max) }}</span></template>
      <template #actions-cell="{ row }">
        <SharedStatusBadge v-if="row.original.shared" size="sm" tone="neutral" :label="t('hrPayroll.gosi.shared')" />
        <SharedRowActions v-else-if="props.canEdit" :actions="rowActions(row.original)" :label="rateLabel(row.original)" />
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
