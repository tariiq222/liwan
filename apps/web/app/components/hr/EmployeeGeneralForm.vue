<script setup lang="ts">
import { saveErrorMessage } from '@/utils/formFeedback'
import { ApiError } from '@/composables/useApi'
import type { HrDepartment } from '@/composables/useHrDepartments'
import { retryHrManagerQueries, useCreateHrEmployee, useHrEmployee, useHrEmployees, useUpdateHrEmployee, hrManagerOptions, type HrEmployee } from '@/composables/useHrEmployees'
import { useHrCountries } from '@/composables/useHrCountries'
import { refDebounced } from '@vueuse/core'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{ employee?: HrEmployee | null; departments: HrDepartment[]; employees: HrEmployee[]; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [employee: HrEmployee] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const toast = useToast()
const formError = ref<unknown>(null)
const errorMessage = computed(() => formError.value ? saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain')) : undefined)
const nameError = ref<string>()
function fieldError(field: string) { if (field === 'name' && nameError.value) return nameError.value; return formError.value instanceof ApiError && formError.value.field === field ? formError.value.message : undefined }
const canManage = computed(() => can('hr.employees.manage'))
const name = ref(''); const email = ref(''); const originalEmail = ref(''); const phone = ref(''); const jobTitle = ref(''); const departmentId = ref<number | null>(null); const managerId = ref<number | null>(null); const nationalityId = ref<number | null>(null)
watch(name, () => { nameError.value = undefined })
const managerSearch = ref('')
const debouncedManagerSearch = refDebounced(managerSearch, 250)
const managerQuery = useHrEmployees(computed(() => ({ q: debouncedManagerSearch.value.trim() || undefined })))
const selectedManagerQuery = useHrEmployee(managerId)
const managerOptions = computed(() => hrManagerOptions({
  employees: props.employees,
  searchResults: managerQuery.data.value?.items ?? [],
  selected: selectedManagerQuery.data.value,
  currentManager: props.employee?.manager,
  search: debouncedManagerSearch.value,
  excludeId: props.employee?.id,
}))
// The contract block exists on the detail shape of a managed employee; the form edits its dates and notice period.
const contractStart = ref<string | null>(null); const contractEnd = ref<string | null>(null); const probationEnd = ref<string | null>(null); const identityExpiry = ref<string | null>(null); const noticeDays = ref('')
const hasContract = computed(() => !!props.employee?.contract)
const contractOrderError = computed(() => contractStart.value && contractEnd.value && contractEnd.value < contractStart.value ? t('hr.employee.contract.endBeforeStart') : undefined)
const noticeValid = computed(() => /^\d{1,4}$/.test(String(noticeDays.value).trim()))
function contractPatch() {
  const current = props.employee?.contract
  if (!current) return undefined
  const patch: Record<string, string | number | null> = {}
  if (contractStart.value !== current.start_date) patch.start_date = contractStart.value
  if (contractEnd.value !== current.end_date) patch.end_date = contractEnd.value
  if (probationEnd.value !== current.probation_end_date) patch.probation_end_date = probationEnd.value
  if (identityExpiry.value !== current.identity_expiry_date) patch.identity_expiry_date = identityExpiry.value
  if (Number(noticeDays.value) !== current.notice_period_days) patch.notice_period_days = Number(noticeDays.value)
  return Object.keys(patch).length ? patch : undefined
}
const countrySearch = ref('')
const countriesQuery = useHrCountries(refDebounced(countrySearch, 250), canManage)
const countryItems = computed(() => {
  const items = new Map<number, string>()
  const selected = props.employee?.nationality
  if (selected) items.set(selected.id, selected.name)
  for (const country of countriesQuery.data.value?.items ?? []) items.set(country.id, country.name)
  return [...items].map(([value, label]) => ({ value, label }))
})
const departmentOptions = computed(() => [{ value: 'none', label: t('hr.depts.none') }, ...props.departments.map(department => ({ value: String(department.id), label: department.name }))])
const managerSelectOptions = computed(() => [{ value: 'none', label: t('hr.depts.none') }, ...managerOptions.value.map(candidate => ({ value: String(candidate.id), label: candidate.name }))])
const selectedManagerError = computed(() => managerId.value !== null && !!selectedManagerQuery.error.value)
const savedState = ref('')
const { mutateAsync: create, isPending: creating } = useCreateHrEmployee()
const { mutateAsync: update, isPending: updating } = useUpdateHrEmployee()
const isPending = computed(() => creating.value || updating.value)
const emailChanged = computed(() => !!props.employee && email.value !== originalEmail.value)
function state() { return JSON.stringify([name.value, email.value, phone.value, jobTitle.value, departmentId.value, managerId.value, nationalityId.value, contractStart.value, contractEnd.value, probationEnd.value, identityExpiry.value, noticeDays.value]) }
const dirty = computed(() => savedState.value !== state())
function retryManagerQueries() {
  if (!canManage.value || !hydrated.value || isPending.value) return
  retryHrManagerQueries(managerId.value, managerQuery.refetch, selectedManagerQuery.refetch)
}
watch(() => props.employee, (employee) => {
  name.value = employee?.name ?? ''
  email.value = employee?.work_email ?? ''
  originalEmail.value = employee?.work_email ?? ''
  phone.value = employee?.work_phone ?? ''
  jobTitle.value = employee?.job_title ?? ''
  departmentId.value = employee?.department?.id ?? null
  managerId.value = employee?.manager?.id ?? null
  nationalityId.value = employee?.nationality?.id ?? null
  contractStart.value = employee?.contract?.start_date ?? null
  contractEnd.value = employee?.contract?.end_date ?? null
  probationEnd.value = employee?.contract?.probation_end_date ?? null
  identityExpiry.value = employee?.contract?.identity_expiry_date ?? null
  noticeDays.value = employee?.contract ? String(employee.contract.notice_period_days) : ''
  savedState.value = state()
}, { immediate: true })
function idOrNull(value: unknown) { return !value || value === 'none' ? null : Number(value) }
let submitting = false
async function submit() {
  if (!canManage.value || !hydrated.value || isPending.value || submitting) return
  nameError.value = undefined
  if (!name.value.trim()) {
    nameError.value = t('hr.employee.nameRequired')
    await nextTick()
    document.getElementById('hr-employee-name')?.focus()
    return
  }
  const emailInput = typeof document === 'undefined' ? null : document.getElementById('hr-employee-email') as HTMLInputElement | null
  if (email.value.trim() && emailInput && !emailInput.validity.valid) {
    formError.value = new ApiError(422, 'invalid', t('hr.employee.emailInvalid'), 'work_email')
    await nextTick()
    emailInput.focus()
    return
  }
  if (hasContract.value && (contractOrderError.value || !noticeValid.value)) {
    formError.value = new ApiError(422, 'invalid', contractOrderError.value ?? t('hr.employee.contract.noticeInvalid'), contractOrderError.value ? 'contract.end_date' : 'contract.notice_period_days')
    return
  }
  submitting = true
  try {
    const employee = props.employee
      ? await update({ id: props.employee.id, patch: { name: name.value.trim(), work_email: email.value.trim(), work_phone: phone.value, job_title: jobTitle.value, department_id: departmentId.value, parent_id: managerId.value, nationality_id: nationalityId.value, contract: contractPatch() } })
      : await create({ name: name.value.trim(), work_email: email.value.trim(), work_phone: phone.value, job_title: jobTitle.value, department_id: departmentId.value, parent_id: managerId.value, nationality_id: nationalityId.value })
    savedState.value = state()
    formError.value = null
    emit('saved', employee)
    toast.add({ title: t('hr.employee.saved'), color: 'success' })
  } catch (error) { formError.value = error } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, email, phone, jobTitle, departmentId, managerId, nationalityId, contractStart, contractEnd, probationEnd, identityExpiry, noticeDays }" class="webvue-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="t('hr.form.saveError')" :description="errorMessage" />
    <SharedFormSection panel :title="t('hr.employee.general')" :description="t('hr.employee.generalHint')">
      <div class="webvue-form-grid">
        <UFormField :label="t('hr.employee.name')" name="hr-employee-name" required :error="fieldError('name')">
          <UInput id="hr-employee-name" v-model="name" class="w-full" :disabled="!canManage || !hydrated || isPending" required />
        </UFormField>
        <UFormField :label="t('hr.employee.jobTitle')" name="hr-employee-job" :error="fieldError('job_title')">
          <UInput id="hr-employee-job" v-model="jobTitle" class="w-full" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.workEmail')" name="hr-employee-email" :error="fieldError('work_email')" :help="props.employee?.access && emailChanged ? t('hr.employee.fixedLogin') : undefined">
          <UInput id="hr-employee-email" v-model="email" type="email" class="w-full" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.workPhone')" name="hr-employee-phone" :error="fieldError('work_phone')">
          <UInput id="hr-employee-phone" v-model="phone" class="w-full" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.nationality')" name="hr-employee-nationality" :help="t('hr.employee.nationalityHint')" :error="fieldError('nationality_id')">
          <USelectMenu
            id="hr-employee-nationality" v-model:search-term="countrySearch" :model-value="nationalityId ?? undefined" class="w-full" value-key="value" :items="countryItems" ignore-filter
            :loading="countriesQuery.isFetching.value" :placeholder="t('hr.employee.nationalityPlaceholder')" :search-input="{ placeholder: t('hr.employee.nationalitySearch') }" :disabled="!canManage || !hydrated || isPending"
            data-testid="hr-employee-nationality" @update:model-value="nationalityId = idOrNull($event)"
          />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hr.employee.assignment')">
      <div class="webvue-form-grid">
        <UFormField :label="t('hr.employee.department')" name="hr-employee-department" :error="fieldError('department_id')">
          <USelect :model-value="departmentId ? String(departmentId) : 'none'" :items="departmentOptions" class="w-full" :disabled="!canManage || !hydrated || isPending" @update:model-value="departmentId = idOrNull($event)" />
        </UFormField>
        <UFormField :label="t('hr.employee.manager')" name="hr-employee-manager-search" class="min-w-0" :error="fieldError('parent_id')">
          <div class="grid gap-2">
            <UInput id="hr-employee-manager-search" v-model="managerSearch" class="w-full" :disabled="!canManage || !hydrated || isPending" :aria-label="t('hr.depts.managerSearch')" :placeholder="t('hr.depts.managerSearch')" icon="i-lucide-search" />
            <UAlert v-if="managerQuery.error.value || selectedManagerError" role="alert" color="error" variant="subtle" :title="t('hr.depts.managerLoadError')">
              <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!canManage || !hydrated || isPending" :label="t('hr.depts.retry')" @click="retryManagerQueries" /></template>
            </UAlert>
            <p v-else-if="managerQuery.isFetching.value" class="text-sm text-muted">{{ t('hr.depts.managerLoading') }}</p>
            <p v-else-if="(managerQuery.data.value?.total ?? 0) > managerOptions.length" class="text-sm text-muted">{{ t('hr.depts.managerLimitNotice') }}</p>
            <USelect id="hr-employee-manager" class="w-full" :model-value="managerId ? String(managerId) : 'none'" :items="managerSelectOptions" :disabled="!canManage || !hydrated || isPending" @update:model-value="managerId = idOrNull($event)" />
          </div>
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection v-if="hasContract" panel :title="t('hr.employee.contract.title')" :description="t('hr.employee.contract.hint')">
      <div class="webvue-form-grid" data-testid="hr-employee-contract">
        <UFormField :label="t('hr.employee.contract.start')" name="hr-contract-start" :error="fieldError('contract.start_date')">
          <SharedDateField id="hr-contract-start" v-model="contractStart" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.contract.end')" name="hr-contract-end" :error="contractOrderError ?? fieldError('contract.end_date')">
          <SharedDateField id="hr-contract-end" v-model="contractEnd" :min-value="contractStart" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.contract.probationEnd')" name="hr-contract-probation" :error="fieldError('contract.probation_end_date')">
          <SharedDateField id="hr-contract-probation" v-model="probationEnd" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.contract.identityExpiry')" name="hr-contract-identity" :error="fieldError('contract.identity_expiry_date')">
          <SharedDateField id="hr-contract-identity" v-model="identityExpiry" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.contract.noticeDays')" name="hr-contract-notice" :error="fieldError('contract.notice_period_days')">
          <UInput id="hr-contract-notice" v-model="noticeDays" type="number" min="0" inputmode="numeric" class="w-full" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="me-auto text-xs text-muted">{{ t('hr.employee.formHint') }}</span>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!canManage || !hydrated || isPending" :loading="isPending" :label="t(props.employee ? 'app.saveChanges' : 'app.create')" />
    </SharedFormActions>
  </UForm>
</template>
