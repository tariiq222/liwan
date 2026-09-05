<script setup lang="ts">
import DeptPanel from '@/components/hr/DeptPanel.vue'
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import DocumentList from '@/components/hr/DocumentList.vue'
import EmployeeCard from '@/components/hr/EmployeeCard.vue'
import CreateEmployeeDialog from '@/components/hr/CreateEmployeeDialog.vue'
import EmployeeDialog from '@/components/hr/EmployeeDialog.vue'
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'

const { me } = useMe()
const canWrite = computed(() => me.value?.role === 'admin' || me.value?.role === 'vendor')
const canAdmin = computed(() => me.value?.role === 'admin')
const hydrated = useHydrated()
const tab = ref('employees')
const createEmployeeOpen = ref(false)

const selectedEmployeeId = ref<number | null>(null)
const managedEmployeeId = ref<number | null>(null)
const requestArchive = ref(false)
const selectedDepartmentId = ref<number | null>(null)
const deptPanelOpen = ref(false)
const { data: departmentData } = useHrDepartments()
const { data: employeeData } = useHrEmployees({})
const departments = computed(() => departmentData.value?.items ?? [])
const employees = computed(() => employeeData.value?.items ?? [])

function onEmployeeOpen(open: boolean) {
  if (!open) selectedEmployeeId.value = null
}
function onEmployeeManage(id: number) { managedEmployeeId.value = id }
async function onEmployeeArchive(id: number) {
  // Open the employee first, then raise the archive request on a distinct
  // tick. A batched open+request could run before EmployeeDialog had observed
  // its closed state, leaving the row action in the general tab.
  requestArchive.value = false
  managedEmployeeId.value = id
  await nextTick()
  requestArchive.value = true
}
function onEmployeeManageOpen(open: boolean) { if (!open) { managedEmployeeId.value = null; requestArchive.value = false } }
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold">{{ $t('hr.directory.title') }}</h1>
      <Button v-if="canAdmin" variant="outline" size="sm" :disabled="!hydrated" @click="tab = 'departments'; deptPanelOpen = true">
        {{ $t('hr.depts.title') }}
      </Button>
    </div>

    <Tabs :model-value="tab" @update:model-value="tab = String($event)">
      <TabsList>
        <TabsTrigger value="employees" :disabled="!hydrated">{{ $t('hr.tabs.employees') }}</TabsTrigger>
        <TabsTrigger value="departments" :disabled="!hydrated">{{ $t('hr.tabs.departments') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="employees" class="space-y-4">
        <DirectoryTable v-model:department-id="selectedDepartmentId" @open="selectedEmployeeId = $event" @manage="onEmployeeManage" @archive="onEmployeeArchive" @create="createEmployeeOpen = true" />
      </TabsContent>
      <TabsContent value="departments" class="space-y-4">
        <Button v-if="canAdmin" variant="outline" :disabled="!hydrated" @click="deptPanelOpen = true">{{ $t('hr.depts.manage') }}</Button>
        <DepartmentTable :departments="departments" :selected-id="selectedDepartmentId" @select="selectedDepartmentId = $event" />
        <p class="text-sm text-muted-foreground">{{ $t('hr.depts.selectHelp') }}</p>
      </TabsContent>
    </Tabs>

    <DocumentList
      v-if="tab === 'departments' && selectedDepartmentId"
      :department-id="selectedDepartmentId"
      :can-write="!!canWrite"
    />

    <EmployeeDialog v-if="canAdmin" :open="managedEmployeeId != null" :employee-id="managedEmployeeId" :request-archive="requestArchive" @update:open="onEmployeeManageOpen" />

    <Sheet :open="selectedEmployeeId != null" @update:open="onEmployeeOpen">
      <SheetContent class="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{{ $t('hr.card.title') }}</SheetTitle>
        </SheetHeader>
        <EmployeeCard v-if="selectedEmployeeId" :employee-id="selectedEmployeeId" />
      </SheetContent>
    </Sheet>

    <DeptPanel
      v-if="canAdmin"
      :open="deptPanelOpen"
      :selected-id="selectedDepartmentId"
      @update:open="deptPanelOpen = $event"
      @select="selectedDepartmentId = $event"
    />

    <CreateEmployeeDialog v-if="canAdmin" v-model:open="createEmployeeOpen" :departments="departments" :employees="employees" @created="selectedEmployeeId = $event.id" />
  </div>
</template>
