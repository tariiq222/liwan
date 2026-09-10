<script setup lang="ts">
import { toast } from 'vue-sonner'
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
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form class="nasq-form" @submit.prevent="submit">
    <SharedFormSection :title="t('hr.depts.formDescription')">
      <div class="nasq-form-grid mt-4">
        <div class="grid gap-2">
          <Label for="hr-dept-name">{{ t('hr.depts.name') }}</Label>
          <Input id="hr-dept-name" v-model="name" :disabled="!canManage || !hydrated || pending" required />
        </div>
        <div class="grid gap-2">
          <Label for="hr-dept-parent">{{ t('hr.depts.parent') }}</Label>
          <Select :model-value="parentId ? String(parentId) : 'none'" :disabled="!canManage || !hydrated || pending" @update:model-value="parentId = idOrNull($event)">
            <SelectTrigger id="hr-dept-parent"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem>
              <SelectItem v-for="department in parentOptions" :key="department.id" :value="String(department.id)">{{ department.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid gap-2">
          <Label for="hr-dept-manager">{{ t('hr.depts.manager') }}</Label>
          <Input v-model="managerSearch" :disabled="!canManage || !hydrated || pending" :aria-label="t('hr.depts.managerSearch')" :placeholder="t('hr.depts.managerSearch')" />
          <div v-if="employeeQuery.error.value || selectedManagerQuery.error.value" class="text-sm text-destructive"><p>{{ t('hr.depts.managerLoadError') }}</p><Button type="button" variant="outline" @click="employeeQuery.refetch(); selectedManagerQuery.refetch()">{{ t('hr.depts.retry') }}</Button></div>
          <p v-else-if="employeeQuery.isFetching.value" class="text-xs text-muted-foreground">{{ t('hr.depts.managerLoading') }}</p>
          <p v-else-if="(employeeQuery.data.value?.total ?? 0) > managerOptions.length" class="text-xs text-muted-foreground">{{ t('hr.depts.managerLimitNotice') }}</p>
          <Select :model-value="managerId ? String(managerId) : 'none'" :disabled="!canManage || !hydrated || pending" @update:model-value="managerId = idOrNull($event)">
            <SelectTrigger id="hr-dept-manager"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem>
              <SelectItem v-for="employee in managerOptions" :key="employee.id" :value="String(employee.id)">{{ employee.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </SharedFormSection>
    <div class="nasq-form-footer"><Button as-child type="button" variant="outline"><NuxtLink :to="props.backTo ?? (props.department ? `/hr/departments/${props.department.id}` : '/hr/departments')">{{ t('app.cancel') }}</NuxtLink></Button><Button type="submit" :disabled="!canManage || !hydrated || pending || !name.trim()">{{ t('app.save') }}</Button></div>
  </form>
</template>
