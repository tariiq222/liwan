<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useCreateDepartment, useUpdateDepartment, type HrDepartment } from '@/composables/useHrDepartments'
import type { HrEmployee } from '@/composables/useHrEmployees'

const props = defineProps<{
  open: boolean
  department?: HrDepartment | null
  departments: HrDepartment[]
  employees: HrEmployee[]
}>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [department: HrDepartment] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref('')
const parentId = ref<number | null>(null)
const managerId = ref<number | null>(null)
const { mutateAsync: create, isPending: creating } = useCreateDepartment()
const { mutateAsync: update, isPending: updating } = useUpdateDepartment()
const editing = computed(() => !!props.department)

watch(() => props.open, (open) => {
  if (!open) return
  name.value = props.department?.name ?? ''
  parentId.value = props.department?.parent_id ?? null
  managerId.value = props.department?.manager?.id ?? null
})
watch(() => props.department, (department) => {
  if (!props.open) return
  name.value = department?.name ?? ''
  parentId.value = department?.parent_id ?? null
  managerId.value = department?.manager?.id ?? null
})
function idOrNull(value: unknown) { return !value || value === 'none' ? null : Number(value) }
async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed || !hydrated.value) return
  try {
    const department = props.department
      ? await update({ id: props.department.id, patch: { name: trimmed, parent_id: parentId.value, manager_id: managerId.value } })
      : await create({ name: trimmed, parent_id: parentId.value, manager_id: managerId.value })
    emit('saved', department)
    emit('update:open', false)
  } catch (error) { toast.error(error instanceof ApiError ? error.message : t('errors.generic')) }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent>
      <DialogHeader><DialogTitle>{{ editing ? t('hr.depts.edit') : t('hr.depts.new') }}</DialogTitle></DialogHeader>
      <form class="grid gap-3" @submit.prevent="submit">
        <div class="grid gap-2"><Label for="hr-dept-name">{{ t('hr.depts.name') }}</Label><Input id="hr-dept-name" v-model="name" :disabled="!hydrated || creating || updating" required /></div>
        <div class="grid gap-2"><Label>{{ t('hr.depts.parent') }}</Label><Select :model-value="parentId ? String(parentId) : 'none'" :disabled="!hydrated || creating || updating" @update:model-value="parentId = idOrNull($event)"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem><SelectItem v-for="department in departments.filter((item) => item.id !== props.department?.id)" :key="department.id" :value="String(department.id)">{{ department.name }}</SelectItem></SelectContent></Select></div>
        <div class="grid gap-2"><Label>{{ t('hr.depts.manager') }}</Label><Select :model-value="managerId ? String(managerId) : 'none'" :disabled="!hydrated || creating || updating" @update:model-value="managerId = idOrNull($event)"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem><SelectItem v-for="employee in employees" :key="employee.id" :value="String(employee.id)">{{ employee.name }}</SelectItem></SelectContent></Select></div>
        <DialogFooter><Button type="submit" :disabled="!hydrated || creating || updating || !name.trim()">{{ t('app.save') }}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
