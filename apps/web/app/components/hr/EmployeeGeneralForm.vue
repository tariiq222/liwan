<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { HrDepartment } from '@/composables/useHrDepartments'
import { useCreateHrEmployee, useUpdateHrEmployee, type HrEmployee } from '@/composables/useHrEmployees'

const props = defineProps<{ employee?: HrEmployee | null; departments: HrDepartment[]; employees: HrEmployee[] }>()
const emit = defineEmits<{ saved: [employee: HrEmployee] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('hr.employees.manage'))
const name = ref(''); const email = ref(''); const originalEmail = ref(''); const phone = ref(''); const jobTitle = ref(''); const departmentId = ref<number | null>(null); const managerId = ref<number | null>(null)
const savedState = ref('')
const { mutateAsync: create, isPending: creating } = useCreateHrEmployee()
const { mutateAsync: update, isPending: updating } = useUpdateHrEmployee()
const isPending = computed(() => creating.value || updating.value)
const emailChanged = computed(() => !!props.employee && email.value !== originalEmail.value)
function state() { return JSON.stringify([name.value, email.value, phone.value, jobTitle.value, departmentId.value, managerId.value]) }
const dirty = computed(() => savedState.value !== state())
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
    toast.success(t('hr.employee.saved'))
  } catch (error) { toast.error(error instanceof Error ? error.message : t('errors.generic')) }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form class="grid gap-3" @submit.prevent="submit">
    <div class="grid gap-2"><Label for="hr-employee-name">{{ t('hr.employee.name') }}</Label><Input id="hr-employee-name" v-model="name" :disabled="!canManage || !hydrated || isPending" required /></div>
    <div class="grid gap-2"><Label for="hr-employee-email">{{ t('hr.employee.workEmail') }}</Label><Input id="hr-employee-email" v-model="email" type="email" :disabled="!canManage || !hydrated || isPending" /><p v-if="props.employee?.access && emailChanged" class="text-xs text-muted-foreground">{{ t('hr.employee.fixedLogin') }}</p></div>
    <div class="grid gap-2"><Label for="hr-employee-phone">{{ t('hr.employee.workPhone') }}</Label><Input id="hr-employee-phone" v-model="phone" :disabled="!canManage || !hydrated || isPending" /></div>
    <div class="grid gap-2"><Label for="hr-employee-job">{{ t('hr.employee.jobTitle') }}</Label><Input id="hr-employee-job" v-model="jobTitle" :disabled="!canManage || !hydrated || isPending" /></div>
    <div class="grid gap-2"><Label>{{ t('hr.employee.department') }}</Label><Select :model-value="departmentId ? String(departmentId) : 'none'" :disabled="!canManage || !hydrated || isPending" @update:model-value="departmentId = idOrNull($event)"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem><SelectItem v-for="department in departments" :key="department.id" :value="String(department.id)">{{ department.name }}</SelectItem></SelectContent></Select></div>
    <div class="grid gap-2"><Label>{{ t('hr.employee.manager') }}</Label><Select :model-value="managerId ? String(managerId) : 'none'" :disabled="!canManage || !hydrated || isPending" @update:model-value="managerId = idOrNull($event)"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem><SelectItem v-for="candidate in employees.filter((item) => item.id !== props.employee?.id)" :key="candidate.id" :value="String(candidate.id)">{{ candidate.name }}</SelectItem></SelectContent></Select></div>
    <Button type="submit" :disabled="!canManage || !hydrated || isPending || !name.trim()">{{ t('app.save') }}</Button>
  </form>
</template>
