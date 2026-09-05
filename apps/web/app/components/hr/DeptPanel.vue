<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useDeleteHrDepartment, useHrDepartments, type HrDepartment } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'
import DepartmentDialog from './DepartmentDialog.vue'
import DepartmentTable from './DepartmentTable.vue'

const props = defineProps<{ open: boolean; selectedId?: number | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; select: [id: number | null] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { me } = useMe()
const canManage = computed(() => me.value?.role === 'admin')
const { data } = useHrDepartments()
const { data: employeeData } = useHrEmployees({})
const departments = computed(() => data.value?.items ?? [])
const employees = computed(() => employeeData.value?.items ?? [])
const dialogOpen = ref(false)
const editing = ref<HrDepartment | null>(null)
const deleting = ref<HrDepartment | null>(null)
const deleteError = ref<ApiError | null>(null)
const { mutateAsync: deleteDepartment, isPending: deletingPending } = useDeleteHrDepartment()

function selectDepartment(id: number) { emit('select', id) }
function openCreate() { editing.value = null; dialogOpen.value = true }
function openEdit(department: HrDepartment) { editing.value = department; dialogOpen.value = true }
function askDelete(department: HrDepartment) { deleting.value = department; deleteError.value = null }
async function confirmDelete() {
  if (!deleting.value || !hydrated.value) return
  const deletedId = deleting.value.id
  try {
    await deleteDepartment(deletedId)
    if (props.selectedId === deletedId) emit('select', null)
    deleting.value = null
    toast.success(t('hr.depts.deleted'))
  } catch (error) {
    deleteError.value = error instanceof ApiError ? error : new ApiError(500, 'http_error', t('errors.generic'))
  }
}
function count(key: 'employees' | 'children' | 'documents') {
  const value = (deleteError.value as (ApiError & { details?: Record<string, unknown> }) | null)?.details?.[key]
  return typeof value === 'number' ? value : 0
}
</script>

<template>
  <Sheet :open="open" @update:open="(value) => emit('update:open', value)">
    <SheetContent class="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader><SheetTitle>{{ t('hr.depts.title') }}</SheetTitle></SheetHeader>
      <div class="grid gap-4 p-4">
        <Button v-if="canManage" :disabled="!hydrated" @click="openCreate">{{ t('hr.depts.new') }}</Button>
        <DepartmentTable :departments="departments" :selected-id="selectedId" :can-manage="canManage && hydrated" @select="selectDepartment" @edit="openEdit" @delete="askDelete" />
      </div>
    </SheetContent>
  </Sheet>

  <DepartmentDialog v-model:open="dialogOpen" :department="editing" :departments="departments" :employees="employees" @saved="(department) => emit('select', department.id)" />

  <Dialog :open="deleting != null" @update:open="(value) => { if (!value) { deleting = null; deleteError = null } }">
    <DialogContent>
      <DialogHeader><DialogTitle>{{ t('hr.depts.delete') }}</DialogTitle><DialogDescription>{{ t('hr.depts.deleteConfirm', { name: deleting?.name }) }}</DialogDescription></DialogHeader>
      <div v-if="deleteError?.code === 'department_in_use'" class="text-sm text-destructive">
        <p>{{ t('hr.depts.inUse') }}</p>
        <ul class="list-disc ps-5"><li v-if="count('employees')">{{ t('hr.depts.employeeReason', { count: count('employees') }) }}</li><li v-if="count('children')">{{ t('hr.depts.childReason', { count: count('children') }) }}</li><li v-if="count('documents')">{{ t('hr.depts.documentReason', { count: count('documents') }) }}</li></ul>
      </div>
      <p v-else-if="deleteError" class="text-sm text-destructive">{{ deleteError.message }}</p>
      <DialogFooter><Button variant="outline" :disabled="deletingPending" @click="deleting = null">{{ t('app.cancel') }}</Button><Button variant="destructive" :disabled="!hydrated || deletingPending" @click="confirmDelete">{{ t('hr.depts.delete') }}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
