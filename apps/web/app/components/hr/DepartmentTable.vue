<script setup lang="ts">
import type { HrDepartment } from '@/composables/useHrDepartments'

defineProps<{
  departments: HrDepartment[]
  selectedId?: number | null
  canManage?: boolean
}>()
const emit = defineEmits<{ select: [id: number]; edit: [department: HrDepartment]; delete: [department: HrDepartment] }>()
const hydrated = useHydrated()
</script>

<template>
  <div class="grid gap-1" data-testid="hr-department-table">
    <div
      v-for="department in departments"
      :key="department.id"
      class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
      :class="{ 'bg-accent': selectedId === department.id }"
    >
      <button type="button" class="min-w-0 flex-1 text-start text-sm" :disabled="!hydrated" @click="emit('select', department.id)">
        <span class="font-medium">{{ department.name }}</span>
        <span class="ms-2 text-muted-foreground">{{ department.employee_count }}</span>
      </button>
      <Button v-if="canManage" variant="ghost" size="sm" @click="emit('edit', department)">{{ $t('hr.depts.edit') }}</Button>
      <Button v-if="canManage" variant="ghost" size="sm" class="text-destructive" @click="emit('delete', department)">
        {{ $t('hr.depts.delete') }}
      </Button>
    </div>
    <p v-if="departments.length === 0" class="text-sm text-muted-foreground">{{ $t('hr.depts.empty') }}</p>
  </div>
</template>
