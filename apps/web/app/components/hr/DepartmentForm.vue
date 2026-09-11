<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useCreateDepartment, useUpdateDepartment, type HrDepartment } from '@/composables/useHrDepartments'
import { useHrEmployees, useHrEmployee, type HrEmployee } from '@/composables/useHrEmployees'
import { refDebounced } from '@vueuse/core'
import { getAllowedParentIds } from '@/lib/departmentTree'

const props = defineProps<{
  department?: HrDepartment | null
  departments: HrDepartment[]
  employees: HrEmployee[]
  backTo?: string
  initialParentId?: number | null
}>()
const emit = defineEmits<{ saved: [department: HrDepartment] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const toast = useToast()
const canManage = computed(() => can('hr.departments.manage'))
const parentOptions = computed(() => { const allowed = new Set(getAllowedParentIds(props.departments, props.department?.id ?? null)); return props.departments.filter(d => allowed.has(d.id)) })
const name = ref('')
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

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed || !canManage.value || !hydrated.value || pending.value) return
  try {
    const department = props.department
      ? await update({ id: props.department.id, patch: { name: trimmed, parent_id: parentId.value, manager_id: managerId.value } })
      : await create({ name: trimmed, parent_id: parentId.value, manager_id: managerId.value })
    savedState.value = state()
    emit('saved', department)
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, parentId, managerId }" class="space-y-5" method="post" @submit="submit">
    <SharedFormSection :title="t('hr.depts.formDescription')">
      <div class="grid gap-4 sm:grid-cols-2 mt-4">
        <UFormField :label="t('hr.depts.name')" name="hr-dept-name" required>
          <UInput id="hr-dept-name" v-model="name" class="w-full" :disabled="!canManage || !hydrated || pending" required />
        </UFormField>
        <UFormField :label="t('hr.depts.parent')" name="hr-dept-parent">
          <USelect id="hr-dept-parent" :model-value="parentId ? String(parentId) : 'none'" :items="parentSelectOptions" class="w-full" :disabled="!canManage || !hydrated || pending" @update:model-value="parentId = idOrNull($event)" />
        </UFormField>
        <UFormField :label="t('hr.depts.manager')" name="hr-dept-manager" class="sm:col-span-2">
          <UInput v-model="managerSearch" class="w-full" :disabled="!canManage || !hydrated || pending" :aria-label="t('hr.depts.managerSearch')" :placeholder="t('hr.depts.managerSearch')" icon="i-lucide-search" />
          <div v-if="employeeQuery.error.value || selectedManagerQuery.error.value" class="mt-2 text-sm text-error">
            <p>{{ t('hr.depts.managerLoadError') }}</p>
            <UButton type="button" color="neutral" variant="outline" :label="t('hr.depts.retry')" @click="employeeQuery.refetch(); selectedManagerQuery.refetch()" />
          </div>
          <p v-else-if="employeeQuery.isFetching.value" class="mt-2 text-xs text-muted">{{ t('hr.depts.managerLoading') }}</p>
          <p v-else-if="(employeeQuery.data.value?.total ?? 0) > managerOptions.length" class="mt-2 text-xs text-muted">{{ t('hr.depts.managerLimitNotice') }}</p>
          <USelect :model-value="managerId ? String(managerId) : 'none'" :items="managerSelectOptions" class="mt-2 w-full" :disabled="!canManage || !hydrated || pending" @update:model-value="managerId = idOrNull($event)" />
        </UFormField>
      </div>
    </SharedFormSection>
    <footer class="flex justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo ?? (props.department ? `/hr/departments/${props.department.id}` : '/hr/departments')" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!canManage || !hydrated || pending || !name.trim()" :label="t('app.save')" />
    </footer>
  </UForm>
</template>
