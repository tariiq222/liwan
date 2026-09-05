<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useArchiveHrEmployee, useHrEmployee, useHrEmployees, useUnarchiveHrEmployee } from '@/composables/useHrEmployees'
import EmployeeAccessPanel from './EmployeeAccessPanel.vue'
import EmployeeGeneralForm from './EmployeeGeneralForm.vue'

const props = defineProps<{ open: boolean; employeeId: number | null; requestArchive?: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()
const { t } = useI18n(); const hydrated = useHydrated(); const tab = ref('general')
const { data: employee } = useHrEmployee(computed(() => props.employeeId))
const { data: departmentData } = useHrDepartments(); const { data: employeeData } = useHrEmployees({})
const departments = computed(() => departmentData.value?.items ?? []); const employees = computed(() => employeeData.value?.items ?? [])
const archiveOpen = ref(false)
const archiveRequestConsumed = ref(false)
const vendorLinked = computed(() => employee.value?.access?.role === 'vendor')
const { mutateAsync: archive, isPending: archiving } = useArchiveHrEmployee()
const { mutateAsync: unarchive, isPending: unarchiving } = useUnarchiveHrEmployee()
const archivePending = computed(() => archiving.value || unarchiving.value)
watch(() => props.open, (open) => { if (open) { tab.value = 'general'; archiveRequestConsumed.value = false } else archiveOpen.value = false })
watch(() => props.requestArchive, (requested) => { if (!requested) archiveRequestConsumed.value = false })
watch([() => props.open, employee, () => props.requestArchive], ([open, value, requested]) => { if (open && value && requested && !archiveRequestConsumed.value && !vendorLinked.value) { archiveOpen.value = true; archiveRequestConsumed.value = true } })
async function confirmArchive() {
  if (!employee.value || !hydrated.value) return
  try {
    if (employee.value.active) await archive(employee.value.id)
    else await unarchive(employee.value.id)
    archiveOpen.value = false
  } catch (error) { toast.error(error instanceof Error ? error.message : t('errors.generic')) }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{{ employee?.name || t('hr.employee.title') }}</DialogTitle></DialogHeader>
      <div v-if="employee" class="grid gap-4">
        <Tabs :model-value="tab" @update:model-value="tab = String($event)"><TabsList><TabsTrigger value="general" :disabled="!hydrated">{{ t('hr.employee.general') }}</TabsTrigger><TabsTrigger value="access" :disabled="!hydrated">{{ t('hr.employee.access') }}</TabsTrigger></TabsList></Tabs>
        <EmployeeGeneralForm v-if="tab === 'general'" :employee="employee" :departments="departments" :employees="employees" />
        <EmployeeAccessPanel v-else :employee="employee" />
        <Button v-if="!vendorLinked" variant="outline" :disabled="!hydrated || archivePending" data-testid="hr-employee-archive" @click="archiveOpen = true">{{ employee.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</Button>
        <p v-else class="text-sm text-muted-foreground">{{ t('hr.employee.archiveVendorReadOnly') }}</p>
      </div>
    </DialogContent>
  </Dialog>
  <Dialog :open="archiveOpen" @update:open="archiveOpen = $event"><DialogContent><DialogHeader><DialogTitle>{{ employee?.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</DialogTitle><DialogDescription>{{ t('hr.employee.archiveConfirm') }}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" :disabled="archivePending" @click="archiveOpen = false">{{ t('app.cancel') }}</Button><Button :disabled="!hydrated || archivePending" @click="confirmArchive">{{ employee?.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</Button></DialogFooter></DialogContent></Dialog>
</template>
