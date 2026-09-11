<script setup lang="ts">
import type { HrDepartment } from '@/composables/useHrDepartments'
import { retryHrManagerQueries, useCreateHrEmployee, useHrEmployee, useHrEmployees, useUpdateHrEmployee, hrManagerOptions, type HrEmployee } from '@/composables/useHrEmployees'
import { refDebounced } from '@vueuse/core'

const props = defineProps<{ employee?: HrEmployee | null; departments: HrDepartment[]; employees: HrEmployee[] }>()
const emit = defineEmits<{ saved: [employee: HrEmployee] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const toast = useToast()
const canManage = computed(() => can('hr.employees.manage'))
const name = ref(''); const email = ref(''); const originalEmail = ref(''); const phone = ref(''); const jobTitle = ref(''); const departmentId = ref<number | null>(null); const managerId = ref<number | null>(null)
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
const departmentOptions = computed(() => [{ value: 'none', label: t('hr.depts.none') }, ...props.departments.map(department => ({ value: String(department.id), label: department.name }))])
const managerSelectOptions = computed(() => [{ value: 'none', label: t('hr.depts.none') }, ...managerOptions.value.map(candidate => ({ value: String(candidate.id), label: candidate.name }))])
const selectedManagerError = computed(() => managerId.value !== null && !!selectedManagerQuery.error.value)
const savedState = ref('')
const { mutateAsync: create, isPending: creating } = useCreateHrEmployee()
const { mutateAsync: update, isPending: updating } = useUpdateHrEmployee()
const isPending = computed(() => creating.value || updating.value)
const emailChanged = computed(() => !!props.employee && email.value !== originalEmail.value)
function state() { return JSON.stringify([name.value, email.value, phone.value, jobTitle.value, departmentId.value, managerId.value]) }
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
  savedState.value = state()
}, { immediate: true })
function idOrNull(value: unknown) { return !value || value === 'none' ? null : Number(value) }
async function submit() {
  if (!canManage.value || !hydrated.value || isPending.value || !name.value.trim()) return
  try {
    const employee = props.employee
      ? await update({ id: props.employee.id, patch: { name: name.value.trim(), work_email: email.value.trim(), work_phone: phone.value, job_title: jobTitle.value, department_id: departmentId.value, parent_id: managerId.value } })
      : await create({ name: name.value.trim(), work_email: email.value.trim(), work_phone: phone.value, job_title: jobTitle.value, department_id: departmentId.value, parent_id: managerId.value })
    savedState.value = state()
    emit('saved', employee)
    toast.add({ title: t('hr.employee.saved'), color: 'success' })
  } catch (error) { toast.add({ title: error instanceof Error ? error.message : t('errors.generic'), color: 'error' }) }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, email, phone, jobTitle, departmentId, managerId }" class="space-y-5" method="post" @submit="submit">
    <SharedFormSection :title="t('hr.employee.general')" :description="t('hr.employee.generalHint')">
      <div class="grid gap-4 sm:grid-cols-2 mt-4">
        <UFormField :label="t('hr.employee.name')" name="hr-employee-name" required>
          <UInput id="hr-employee-name" v-model="name" class="w-full" :disabled="!canManage || !hydrated || isPending" required />
        </UFormField>
        <UFormField :label="t('hr.employee.jobTitle')" name="hr-employee-job">
          <UInput id="hr-employee-job" v-model="jobTitle" class="w-full" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hr.employee.workEmail')" name="hr-employee-email">
          <UInput id="hr-employee-email" v-model="email" type="email" class="w-full" :disabled="!canManage || !hydrated || isPending" />
          <p v-if="props.employee?.access && emailChanged" class="mt-1 text-xs text-muted">{{ t('hr.employee.fixedLogin') }}</p>
        </UFormField>
        <UFormField :label="t('hr.employee.workPhone')" name="hr-employee-phone">
          <UInput id="hr-employee-phone" v-model="phone" class="w-full" :disabled="!canManage || !hydrated || isPending" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection :title="t('hr.employee.assignment')">
      <div class="grid gap-4 sm:grid-cols-2 mt-4">
        <UFormField :label="t('hr.employee.department')" name="hr-employee-department">
          <USelect :model-value="departmentId ? String(departmentId) : 'none'" :items="departmentOptions" class="w-full" :disabled="!canManage || !hydrated || isPending" @update:model-value="departmentId = idOrNull($event)" />
        </UFormField>
        <UFormField :label="t('hr.employee.manager')" name="hr-employee-manager-search" class="min-w-0">
          <UInput id="hr-employee-manager-search" v-model="managerSearch" class="w-full" :disabled="!canManage || !hydrated || isPending" :aria-label="t('hr.depts.managerSearch')" :placeholder="t('hr.depts.managerSearch')" icon="i-lucide-search" />
          <div v-if="managerQuery.error.value || selectedManagerError" class="mt-2 text-sm text-error">
            <p>{{ t('hr.depts.managerLoadError') }}</p>
            <UButton type="button" color="secondary" variant="solid" :disabled="!canManage || !hydrated || isPending" :label="t('hr.depts.retry')" @click="retryManagerQueries" />
          </div>
          <p v-else-if="managerQuery.isFetching.value" class="mt-2 text-xs text-muted">{{ t('hr.depts.managerLoading') }}</p>
          <USelect id="hr-employee-manager" class="mt-2 min-w-0 w-full" :model-value="managerId ? String(managerId) : 'none'" :items="managerSelectOptions" :disabled="!canManage || !hydrated || isPending" @update:model-value="managerId = idOrNull($event)" />
        </UFormField>
      </div>
    </SharedFormSection>
    <footer class="flex flex-wrap items-center justify-end gap-2">
      <span class="me-auto text-xs text-muted">{{ t('hr.employee.formHint') }}</span>
      <slot name="actions" />
      <UButton type="submit" color="primary" :disabled="!canManage || !hydrated || isPending || !name.trim()" :label="t('app.save')" />
    </footer>
  </UForm>
</template>
