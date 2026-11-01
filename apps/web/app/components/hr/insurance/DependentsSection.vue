<script setup lang="ts">
import type { HrInsuranceDependent, HrInsuranceRelation } from '@liwan/contracts'
import { HR_INSURANCE_RELATIONS } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { useQueryClient } from '@tanstack/vue-query'
import { hrInsuranceKeys, isHrInsuranceConflict } from '@/composables/useHrInsurance'

// The dependents of one enrollment, on its record page: add, edit and end happen inline, and ending asks for
// an inline confirmation. A dependent's identity number shows masked until the manager opens its edit row.
const props = defineProps<{
  enrollmentId: number
  dependents: HrInsuranceDependent[]
  canEdit: boolean
  requireId: boolean
  /** The enrollment's own dates: a dependent's coverage lies inside them. */
  from: string
  to: string
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const add = useAddHrInsuranceDependent()
const patch = usePatchHrInsuranceDependent()
const end = useEndHrInsuranceDependent()
const busy = computed(() => add.isPending.value || patch.isPending.value || end.isPending.value)

type Draft = { revision: number; name: string; relation: HrInsuranceRelation | undefined; birthDate: string | null; nationalId: string; dateFrom: string | null; dateTo: string | null }
const empty = (): Draft => ({ revision: 0, name: '', relation: undefined, birthDate: null, nationalId: '', dateFrom: props.from, dateTo: null })
const draft = ref<Draft>(empty())
// null: nothing open; 0: the add row; an id: that dependent's edit row.
const editing = ref<number | null>(null)
const ending = ref<number | null>(null)
// The revision the editor or the end confirmation opened at: a background refetch never advances it, so a concurrent edit answers 409.
const endRevision = ref(0)
const endDate = ref<string | null>(null)
const attempted = ref(false)
const error = ref('')
const conflict = ref(false)
const qc = useQueryClient()
const serverField = ref('')

const relationItems = computed(() => HR_INSURANCE_RELATIONS.map(value => ({ value, label: t(`hrInsurance.relation.${value}`) })))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const nameError = computed(() => attempted.value && !draft.value.name.trim() ? t('hrInsurance.dependents.nameRequired') : fieldError('name'))
const relationError = computed(() => attempted.value && !draft.value.relation ? t('hrInsurance.dependents.relationRequired') : fieldError('relation'))
const idError = computed(() => attempted.value && props.requireId && !draft.value.nationalId.trim() ? t('hrInsurance.dependents.idRequired') : fieldError('national_id'))
const dateError = computed(() => attempted.value && !draft.value.dateFrom ? t('hrInsurance.dependents.dateRequired') : fieldError('date_from') ?? fieldError('date_to'))

function reset() {
  editing.value = null
  ending.value = null
  attempted.value = false
  error.value = ''
  conflict.value = false
  serverField.value = ''
  draft.value = empty()
}
function openAdd() {
  reset()
  editing.value = 0
}
function openEdit(row: HrInsuranceDependent) {
  reset()
  editing.value = row.id
  draft.value = { revision: row.revision, name: row.name, relation: row.relation, birthDate: row.birth_date, nationalId: row.national_id ?? '', dateFrom: row.date_from, dateTo: row.date_to }
}
function openEnd(row: HrInsuranceDependent) {
  reset()
  ending.value = row.id
  endRevision.value = row.revision
  endDate.value = null
}
function reload() {
  reset()
  void qc.invalidateQueries({ queryKey: hrInsuranceKeys.all })
}
function failed(cause: unknown) {
  conflict.value = isHrInsuranceConflict(cause)
  error.value = isHrInsuranceConflict(cause) ? t('hrInsurance.conflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
  serverField.value = cause instanceof ApiError && !isHrInsuranceConflict(cause) ? cause.field ?? '' : ''
}

async function save(row?: HrInsuranceDependent) {
  if (!hydrated.value || busy.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  const value = draft.value
  if (!value.name.trim() || !value.relation || !value.dateFrom || (props.requireId && !value.nationalId.trim())) return
  const common = { name: value.name.trim(), relation: value.relation, date_from: value.dateFrom }
  try {
    // A cleared optional field is sent as an explicit null on an edit, so the server clears it; a new row just leaves it out.
    if (row) {
      await patch.mutateAsync({ id: row.id, body: { ...common, birth_date: value.birthDate, national_id: value.nationalId.trim() || null, date_to: value.dateTo, revision: value.revision } })
    } else {
      await add.mutateAsync({ enrollmentId: props.enrollmentId, body: { ...common, birth_date: value.birthDate ?? undefined, national_id: value.nationalId.trim() || undefined, date_to: value.dateTo ?? undefined } })
    }
    reset()
  } catch (cause) { failed(cause) }
}
async function confirmEnd(row: HrInsuranceDependent) {
  if (!hydrated.value || busy.value) return
  error.value = ''
  try {
    await end.mutateAsync({ id: row.id, revision: endRevision.value, dateEnd: endDate.value ?? undefined })
    reset()
  } catch (cause) { failed(cause) }
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('hrInsurance.dependents.title')">
    <template v-if="props.canEdit && editing === null" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated" :label="t('hrInsurance.dependents.add')" data-testid="hr-insurance-dependent-add" @click="openAdd" />
    </template>
    <div class="grid gap-4">
      <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" data-testid="hr-insurance-dependents-error">
        <template v-if="conflict" #actions><UButton type="button" color="neutral" variant="outline" size="sm" :label="t('hrInsurance.reload')" data-testid="hr-insurance-dependents-reload" @click="reload" /></template>
      </UAlert>
      <p v-if="!props.dependents.length && editing !== 0" class="text-sm text-muted" data-testid="hr-insurance-dependents-empty">{{ t('hrInsurance.dependents.empty') }}</p>
      <ul v-else class="grid gap-3" data-testid="hr-insurance-dependents">
        <li v-for="row in props.dependents" :key="row.id" class="grid gap-3 rounded-card p-3 ring ring-default" :data-testid="`hr-insurance-dependent-${row.id}`">
          <div v-if="editing !== row.id" class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold text-highlighted">{{ row.name }} <span class="font-normal text-muted">· {{ t(`hrInsurance.relation.${row.relation}`) }}</span></p>
              <p class="tabular-nums text-sm text-muted">
                {{ formatDate(row.date_from) }} – {{ row.date_to ? formatDate(row.date_to) : t('hrInsurance.untilPlanEnd') }}
                <template v-if="row.national_id_masked"> · <bdi dir="ltr">{{ row.national_id_masked }}</bdi></template>
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <SharedStatusBadge size="sm" :tone="row.state === 'active' ? 'success' : 'neutral'" :label="t(`hrInsurance.dependents.state.${row.state}`)" />
              <template v-if="props.canEdit && row.state === 'active' && ending !== row.id">
                <UButton color="neutral" variant="ghost" :disabled="!hydrated || busy" :label="t('app.edit')" :data-testid="`hr-insurance-dependent-edit-${row.id}`" @click="openEdit(row)" />
                <UButton color="error" variant="ghost" :disabled="!hydrated || busy" :label="t('hrInsurance.dependents.end')" :data-testid="`hr-insurance-dependent-end-${row.id}`" @click="openEnd(row)" />
              </template>
            </div>
          </div>
          <SharedInlineConfirm
            v-if="ending === row.id"
            :title="t('hrInsurance.dependents.endTitle', { name: row.name })"
            :description="t('hrInsurance.dependents.endHint')"
            :confirm-label="t('hrInsurance.dependents.end')"
            :pending="end.isPending.value"
            @confirm="confirmEnd(row)"
            @cancel="reset"
          >
            <UFormField :label="t('hrInsurance.dependents.endDate')" for="hr-insurance-dependent-end-date" class="mt-2" :hint="t('hrInsurance.dependents.endDateHint')">
              <SharedDateField id="hr-insurance-dependent-end-date" v-model="endDate" />
            </UFormField>
          </SharedInlineConfirm>
          <form v-if="editing === row.id" class="grid gap-3" :data-testid="`hr-insurance-dependent-form-${row.id}`" @submit.prevent="save(row)">
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField :label="t('hrInsurance.dependents.name')" :name="`hr-insurance-dependent-name-${row.id}`" required :error="nameError"><UInput v-model="draft.name" class="w-full" :disabled="busy" /></UFormField>
              <UFormField :label="t('hrInsurance.dependents.relationLabel')" :name="`hr-insurance-dependent-relation-${row.id}`" required :error="relationError"><USelect v-model="draft.relation" class="w-full" :items="relationItems" :disabled="busy" /></UFormField>
              <UFormField :label="t('hrInsurance.dependents.birthDate')" :name="`hr-insurance-dependent-birth-${row.id}`"><SharedDateField v-model="draft.birthDate" :disabled="busy" /></UFormField>
              <UFormField :label="t('hrInsurance.dependents.nationalId')" :name="`hr-insurance-dependent-id-${row.id}`" :required="props.requireId" :error="idError"><UInput v-model="draft.nationalId" class="w-full" dir="ltr" :disabled="busy" /></UFormField>
              <UFormField :label="t('hrInsurance.dependents.dateFrom')" :name="`hr-insurance-dependent-from-${row.id}`" required :error="dateError"><SharedDateField v-model="draft.dateFrom" :disabled="busy" /></UFormField>
              <UFormField :label="t('hrInsurance.dependents.dateTo')" :name="`hr-insurance-dependent-to-${row.id}`"><SharedDateField v-model="draft.dateTo" :disabled="busy" /></UFormField>
            </div>
            <div class="flex justify-end gap-2">
              <UButton type="button" color="neutral" variant="outline" :disabled="busy" :label="t('app.cancel')" @click="reset" />
              <UButton type="submit" color="primary" :loading="patch.isPending.value" :disabled="!hydrated || busy" :label="t('app.saveChanges')" data-testid="hr-insurance-dependent-save" />
            </div>
          </form>
        </li>
      </ul>
      <form v-if="editing === 0" class="grid gap-3 rounded-card p-3 ring ring-default" data-testid="hr-insurance-dependent-form" @submit.prevent="save()">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('hrInsurance.dependents.name')" name="hr-insurance-dependent-new-name" required :error="nameError"><UInput id="hr-insurance-dependent-new-name" v-model="draft.name" class="w-full" :disabled="busy" data-testid="hr-insurance-dependent-name" /></UFormField>
          <UFormField :label="t('hrInsurance.dependents.relationLabel')" name="hr-insurance-dependent-new-relation" required :error="relationError"><USelect id="hr-insurance-dependent-new-relation" v-model="draft.relation" class="w-full" :items="relationItems" :placeholder="t('hrInsurance.dependents.chooseRelation')" :disabled="busy" data-testid="hr-insurance-dependent-relation" /></UFormField>
          <UFormField :label="t('hrInsurance.dependents.birthDate')" name="hr-insurance-dependent-new-birth"><SharedDateField id="hr-insurance-dependent-new-birth" v-model="draft.birthDate" :disabled="busy" /></UFormField>
          <UFormField :label="t('hrInsurance.dependents.nationalId')" name="hr-insurance-dependent-new-id" :required="props.requireId" :error="idError" :hint="props.requireId ? undefined : t('hrInsurance.dependents.idOptional')"><UInput id="hr-insurance-dependent-new-id" v-model="draft.nationalId" class="w-full" dir="ltr" :disabled="busy" data-testid="hr-insurance-dependent-national-id" /></UFormField>
          <UFormField :label="t('hrInsurance.dependents.dateFrom')" name="hr-insurance-dependent-new-from" required :error="dateError"><SharedDateField id="hr-insurance-dependent-new-from" v-model="draft.dateFrom" :disabled="busy" /></UFormField>
          <UFormField :label="t('hrInsurance.dependents.dateTo')" name="hr-insurance-dependent-new-to" :hint="t('hrInsurance.dependents.dateToHint', { to: props.to })"><SharedDateField id="hr-insurance-dependent-new-to" v-model="draft.dateTo" :disabled="busy" /></UFormField>
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="busy" :label="t('app.cancel')" @click="reset" />
          <UButton type="submit" color="primary" :loading="add.isPending.value" :disabled="!hydrated || busy" :label="t('hrInsurance.dependents.save')" data-testid="hr-insurance-dependent-submit" />
        </div>
      </form>
    </div>
  </SharedRecordSection>
</template>
