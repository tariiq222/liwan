<script setup lang="ts">
import { saveErrorMessage } from '@/utils/formFeedback'
import { ApiError } from '@/composables/useApi'
import { useCreateDepartment, useUpdateDepartment, type HrDepartment } from '@/composables/useHrDepartments'
import { useHrEmployees, useHrEmployee, type HrEmployee } from '@/composables/useHrEmployees'
import { refDebounced } from '@vueuse/core'
import { getAllowedParentIds } from '@/lib/departmentTree'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  department?: HrDepartment | null
  departments: HrDepartment[]
  employees: HrEmployee[]
  backTo: RouteLocationRaw
  initialParentId?: number | null
}>()
const emit = defineEmits<{ saved: [department: HrDepartment] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const formError = ref<unknown>(null)
const errorMessage = computed(() => formError.value ? saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain')) : undefined)
const nameError = ref<string>()
function fieldError(field: string) { if (field === 'name' && nameError.value) return nameError.value; return formError.value instanceof ApiError && formError.value.field === field ? formError.value.message : undefined }
const canManage = computed(() => can('hr.departments.manage'))
const parentOptions = computed(() => { const allowed = new Set(getAllowedParentIds(props.departments, props.department?.id ?? null)); return props.departments.filter(d => allowed.has(d.id)) })
const name = ref('')
watch(name, () => { nameError.value = undefined })
const parentId = ref<number | null>(null)
const managerId = ref<number | null>(null)
const managerSearch = ref('')
const debouncedManagerSearch = refDebounced(managerSearch, 250)
const employeeQuery = useHrEmployees(computed(() => ({ q: debouncedManagerSearch.value || undefined })))
const selectedManagerQuery = useHrEmployee(managerId)
const managerOptions = computed(() => {
  const options = new Map<number, { id: number; name: string }>()
  const employees = managerSearch.value ? employeeQuery.data.value?.items ?? [] : employeeQuery.data.value?.items ?? props.employees
  for (const employee of employees) options.set(employee.id, employee)
  if (props.department?.manager) options.set(props.department.manager.id, props.department.manager)
  if (selectedManagerQuery.data.value) options.set(selectedManagerQuery.data.value.id, selectedManagerQuery.data.value)
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
})
const parentSelectOptions = computed(() => [{ value: 'none', label: t('hr.depts.none') }, ...parentOptions.value.map(department => ({ value: String(department.id), label: department.name }))])
const managerSelectOptions = computed(() => [{ value: 'none', label: t('hr.depts.none') }, ...managerOptions.value.map(employee => ({ value: String(employee.id), label: employee.name }))])
const savedState = ref('')
const { mutateAsync: create, isPending: creating } = useCreateDepartment()
const { mutateAsync: update, isPending: updating } = useUpdateDepartment()
const pending = computed(() => creating.value || updating.value)
function state() { return JSON.stringify([name.value, parentId.value, managerId.value]) }
const dirty = computed(() => savedState.value !== state())

watch(() => props.department, (department) => {
  name.value = department?.name ?? ''
  parentId.value = department?.parent_id ?? props.initialParentId ?? null
  managerId.value = department?.manager?.id ?? null
  savedState.value = state()
}, { immediate: true })

function idOrNull(value: unknown) { return !value || value === 'none' ? null : Number(value) }

let submitting = false
async function submit() {
  if (!canManage.value || !hydrated.value || pending.value || submitting) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    nameError.value = t('hr.depts.nameRequired')
    await nextTick()
    document.getElementById('hr-dept-name')?.focus()
    return
  }
  submitting = true
  try {
    const department = props.department
      ? await update({ id: props.department.id, patch: { name: trimmed, parent_id: parentId.value, manager_id: managerId.value } })
      : await create({ name: trimmed, parent_id: parentId.value, manager_id: managerId.value })
    savedState.value = state()
    formError.value = null
    emit('saved', department)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, parentId, managerId }" class="liwan-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="t('hr.form.saveError')" :description="errorMessage" />
    <SharedFormSection panel :title="t('hr.depts.general')" :description="t('hr.depts.formDescription')">
      <div class="liwan-form-grid">
        <UFormField :label="t('hr.depts.name')" name="hr-dept-name" required :error="fieldError('name')">
          <UInput id="hr-dept-name" v-model="name" class="w-full" :disabled="!canManage || !hydrated || pending" required />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hr.depts.assignment')">
      <div class="liwan-form-grid">
        <UFormField :label="t('hr.depts.parent')" name="hr-dept-parent" :error="fieldError('parent_id')">
          <USelect id="hr-dept-parent" :model-value="parentId ? String(parentId) : 'none'" :items="parentSelectOptions" class="w-full" :disabled="!canManage || !hydrated || pending" @update:model-value="parentId = idOrNull($event)" />
        </UFormField>
        <UFormField :label="t('hr.depts.manager')" name="hr-dept-manager-search" class="min-w-0" :error="fieldError('manager_id')">
          <div class="grid gap-2">
            <UInput id="hr-dept-manager-search" v-model="managerSearch" class="w-full" :disabled="!canManage || !hydrated || pending" :aria-label="t('hr.depts.managerSearch')" :placeholder="t('hr.depts.managerSearch')" icon="i-lucide-search" />
            <UAlert v-if="employeeQuery.error.value || selectedManagerQuery.error.value" role="alert" color="error" variant="subtle" :title="t('hr.depts.managerLoadError')">
              <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!canManage || !hydrated || pending" :label="t('hr.depts.retry')" @click="employeeQuery.refetch(); selectedManagerQuery.refetch()" /></template>
            </UAlert>
            <p v-else-if="employeeQuery.isFetching.value" class="text-sm text-muted">{{ t('hr.depts.managerLoading') }}</p>
            <p v-else-if="(employeeQuery.data.value?.total ?? 0) > managerOptions.length" class="text-sm text-muted">{{ t('hr.depts.managerLimitNotice') }}</p>
            <USelect id="hr-dept-manager" class="w-full" :model-value="managerId ? String(managerId) : 'none'" :items="managerSelectOptions" :disabled="!canManage || !hydrated || pending" @update:model-value="managerId = idOrNull($event)" />
          </div>
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="me-auto text-xs text-muted">{{ t('hr.depts.formHint') }}</span>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!canManage || !hydrated || pending" :loading="pending" :label="t(props.department ? 'app.saveChanges' : 'app.create')" />
    </SharedFormActions>
  </UForm>
</template>
