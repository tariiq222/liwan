<script setup lang="ts">
import type { HrDepartment } from '@/composables/useHrDepartments'
import {
  useCreateHrEmployee,
  type HrEmployee,
} from '@/composables/useHrEmployees'

defineProps<{ departments: HrDepartment[]; employees: HrEmployee[] }>()
const emit = defineEmits<{ created: [employee: HrEmployee] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const name = ref('')
const email = ref('')
const phone = ref('')
const jobTitle = ref('')
const departmentId = ref<number | null>(null)
const managerId = ref<number | null>(null)
const { mutateAsync: create, isPending } = useCreateHrEmployee()
function idOrNull(value: unknown) {
  return !value || value === 'none' ? null : Number(value)
}
async function submit() {
  if (!hydrated.value || !name.value.trim()) return
  try {
    emit(
      'created',
      await create({
        name: name.value.trim(),
        work_email: email.value.trim(),
        work_phone: phone.value,
        job_title: jobTitle.value,
        department_id: departmentId.value,
        parent_id: managerId.value,
      }),
    )
  } catch (error) {
    toast.add({ title: error instanceof Error ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>
<template>
  <UForm :state="{ name, email, phone, jobTitle, departmentId, managerId }" class="grid gap-4" method="post" @submit="submit">
    <UFormField :label="t('hr.employee.name')" name="hr-create-name" required>
      <UInput id="hr-create-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" required />
    </UFormField>
    <UFormField :label="t('hr.employee.workEmail')" name="hr-create-email">
      <UInput id="hr-create-email" v-model="email" type="email" class="w-full" :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField :label="t('hr.employee.workPhone')" name="hr-create-phone">
      <UInput id="hr-create-phone" v-model="phone" class="w-full" :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField :label="t('hr.employee.jobTitle')" name="hr-create-job">
      <UInput id="hr-create-job" v-model="jobTitle" class="w-full" :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField :label="t('hr.employee.department')" name="hr-create-department">
      <USelect
        :model-value="departmentId ? String(departmentId) : 'none'"
        :items="[{ value: 'none', label: t('hr.depts.none') }, ...departments.map(department => ({ value: String(department.id), label: department.name }))]"
        class="w-full"
        :disabled="!hydrated || isPending"
        @update:model-value="departmentId = idOrNull($event)"
      />
    </UFormField>
    <UFormField :label="t('hr.employee.manager')" name="hr-create-manager">
      <USelect
        :model-value="managerId ? String(managerId) : 'none'"
        :items="[{ value: 'none', label: t('hr.depts.none') }, ...employees.map(employee => ({ value: String(employee.id), label: employee.name }))]"
        class="w-full"
        :disabled="!hydrated || isPending"
        @update:model-value="managerId = idOrNull($event)"
      />
    </UFormField>
    <UButton type="submit" color="primary" :disabled="!hydrated || isPending || !name.trim()" :label="t('app.save')" />
  </UForm>
</template>
