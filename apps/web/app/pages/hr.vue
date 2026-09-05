<script setup lang="ts">
import DeptPanel from '@/components/hr/DeptPanel.vue'
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import DocumentList from '@/components/hr/DocumentList.vue'
import EmployeeCard from '@/components/hr/EmployeeCard.vue'

const { me } = useMe()
const canWrite = computed(() => me.value?.role === 'admin' || me.value?.role === 'vendor')

const selectedEmployeeId = ref<number | null>(null)
const selectedDepartmentId = ref<number | null>(null)
const deptPanelOpen = ref(false)

function onEmployeeOpen(open: boolean) {
  if (!open) selectedEmployeeId.value = null
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold">{{ $t('hr.directory.title') }}</h1>
      <Button v-if="canWrite" variant="outline" size="sm" @click="deptPanelOpen = true">
        {{ $t('hr.depts.title') }}
      </Button>
    </div>

    <DirectoryTable v-model:department-id="selectedDepartmentId" @open="selectedEmployeeId = $event" />

    <DocumentList
      v-if="selectedDepartmentId"
      :department-id="selectedDepartmentId"
      :can-write="!!canWrite"
    />

    <Sheet :open="selectedEmployeeId != null" @update:open="onEmployeeOpen">
      <SheetContent class="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{{ $t('hr.card.title') }}</SheetTitle>
        </SheetHeader>
        <EmployeeCard v-if="selectedEmployeeId" :employee-id="selectedEmployeeId" />
      </SheetContent>
    </Sheet>

    <DeptPanel
      v-if="canWrite"
      :open="deptPanelOpen"
      :selected-id="selectedDepartmentId"
      @update:open="deptPanelOpen = $event"
      @select="selectedDepartmentId = $event"
    />
  </div>
</template>
