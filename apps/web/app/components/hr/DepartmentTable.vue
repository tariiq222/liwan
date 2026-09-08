<script setup lang="ts">
import type { HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{
  departments: HrDepartment[]
  selectedId?: number | null
  canManage?: boolean
  canDelete?: boolean
}>()
const emit = defineEmits<{ select: [id: number]; edit: [department: HrDepartment]; delete: [department: HrDepartment] }>()
const hydrated = useHydrated()
const { can } = useAccess()
const route = useRoute()
const canManage = computed(() => !!props.canManage && can('hr.departments.manage'))
</script>

<template>
  <div class="nasq-panel overflow-hidden" data-testid="hr-department-table">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="text-start">{{ $t('hr.depts.name') }}</TableHead>
          <TableHead class="text-start">{{ $t('hr.depts.manager') }}</TableHead>
          <TableHead v-if="canManage" class="text-start">{{ $t('hr.directory.columns.actions') }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty v-if="!departments.length" :colspan="canManage ? 3 : 2">
          <p class="text-muted-foreground">{{ $t('hr.depts.empty') }}</p>
        </TableEmpty>
        <TableRow
          v-for="department in departments"
          :key="department.id"
          class="cursor-pointer transition-colors hover:bg-muted/30"
          :class="{ 'bg-muted/40': selectedId === department.id }"
          @click="hydrated && emit('select', department.id)"
        >
          <TableCell class="text-start">
            <span class="font-medium">{{ department.name }}</span>
            <span class="ms-2 text-muted-foreground">{{ department.employee_count }}</span>
          </TableCell>
          <TableCell class="text-start text-muted-foreground">{{ department.manager?.name || $t('hr.depts.noManager') }}</TableCell>
          <TableCell v-if="canManage" class="text-start" @click.stop>
            <div class="flex flex-wrap gap-1">
              <NuxtLink :to="{ path: `/hr/departments/${department.id}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()">
                <Button variant="ghost" size="sm" :disabled="!hydrated">{{ $t('hr.depts.edit') }}</Button>
              </NuxtLink>
              <Button v-if="props.canDelete !== false" variant="ghost" size="sm" class="text-destructive" :disabled="!hydrated" @click="emit('delete', department)">
                {{ $t('hr.depts.delete') }}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
