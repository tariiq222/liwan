<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useCreateDepartment, useUpdateDepartment, type HrDepartment } from '@/composables/useHrDepartments'
import type { HrEmployee } from '@/composables/useHrEmployees'

const props = defineProps<{
  department?: HrDepartment | null
  departments: HrDepartment[]
  employees: HrEmployee[]
  backTo?: string
}>()
const emit = defineEmits<{ saved: [department: HrDepartment] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref('')
const parentId = ref<number | null>(null)
const managerId = ref<number | null>(null)
const savedState = ref('')
const { mutateAsync: create, isPending: creating } = useCreateDepartment()
const { mutateAsync: update, isPending: updating } = useUpdateDepartment()
const pending = computed(() => creating.value || updating.value)
function state() { return JSON.stringify([name.value, parentId.value, managerId.value]) }
const dirty = computed(() => savedState.value !== state())

watch(() => props.department, (department) => {
  name.value = department?.name ?? ''
  parentId.value = department?.parent_id ?? null
  managerId.value = department?.manager?.id ?? null
  savedState.value = state()
}, { immediate: true })

function idOrNull(value: unknown) { return !value || value === 'none' ? null : Number(value) }

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed || !hydrated.value) return
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
  <form class="grid max-w-xl gap-4" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="hr-dept-name">{{ t('hr.depts.name') }}</Label>
      <Input id="hr-dept-name" v-model="name" :disabled="!hydrated || pending" required />
    </div>
    <div class="grid gap-2">
      <Label>{{ t('hr.depts.parent') }}</Label>
      <Select :model-value="parentId ? String(parentId) : 'none'" :disabled="!hydrated || pending" @update:model-value="parentId = idOrNull($event)">
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem>
          <SelectItem v-for="department in departments.filter((item) => item.id !== props.department?.id)" :key="department.id" :value="String(department.id)">{{ department.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div class="grid gap-2">
      <Label>{{ t('hr.depts.manager') }}</Label>
      <Select :model-value="managerId ? String(managerId) : 'none'" :disabled="!hydrated || pending" @update:model-value="managerId = idOrNull($event)">
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem>
          <SelectItem v-for="employee in employees" :key="employee.id" :value="String(employee.id)">{{ employee.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button type="submit" :disabled="!hydrated || pending || !name.trim()">{{ t('app.save') }}</Button>
      <NuxtLink :to="props.backTo ?? (props.department ? `/hr/departments/${props.department.id}` : '/hr/departments')"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
    </div>
  </form>
</template>
