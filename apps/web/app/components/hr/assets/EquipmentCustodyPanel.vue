<script setup lang="ts">
import type { HrEquipment, HrRef } from '@webvue/contracts'
import { formatDate } from '@webvue/ui/app/utils/formatDate'

// The custody block of one asset: who holds it now, since when, and the assignment
// control. The page owns the mutation and the inline confirmations.
const props = defineProps<{
  equipment: HrEquipment
  employees: HrRef[]
  canManage: boolean
  pending: boolean
}>()
const emit = defineEmits<{ assign: [employeeId: number, assignDate: string] }>()

const { t } = useI18n()
const hydrated = useHydrated()

function localToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

const employeeId = ref<number | null>(null)
const assignDate = ref<string | null>(null)
// Filled after hydration from the browser's own day: toISOString would give the UTC day.
onMounted(() => { assignDate.value ??= localToday() })

const employeeOptions = computed(() => props.employees.map(employee => ({
  value: String(employee.id),
  label: employee.name,
})))
const canAssign = computed(() => props.canManage && !props.pending && !props.equipment.employee && !!employeeId.value && !!assignDate.value)

function assign() {
  if (!hydrated.value || !canAssign.value || !employeeId.value || !assignDate.value) return
  emit('assign', employeeId.value, assignDate.value)
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('hrAssets.custody.title')">
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t('hrAssets.columns.employee')" :value="props.equipment.employee?.name || t('hrAssets.unassigned')" />
      <SharedPropertyRow
        :label="t('hrAssets.custody.since')"
        :value="props.equipment.employee && props.equipment.assign_date ? formatDate(props.equipment.assign_date) : t('hrAssets.custody.never')"
      />
    </SharedPropertiesPanel>
    <div v-if="props.canManage && !props.equipment.employee" class="mt-4 grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('hrAssets.custody.employee')" for="hr-asset-assign-employee">
        <USelect
          id="hr-asset-assign-employee"
          class="w-full"
          :model-value="employeeId ? String(employeeId) : undefined"
          :items="employeeOptions"
          :placeholder="t('hrAssets.custody.chooseEmployee')"
          :disabled="!hydrated || props.pending"
          data-testid="hr-asset-assign-employee"
          @update:model-value="employeeId = $event ? Number($event) : null"
        />
      </UFormField>
      <UFormField :label="t('hrAssets.custody.date')" for="hr-asset-assign-date">
        <SharedDateField id="hr-asset-assign-date" v-model="assignDate" :disabled="!hydrated || props.pending" />
      </UFormField>
      <div class="sm:col-span-2">
        <UButton
          color="primary"
          :disabled="!hydrated || !canAssign"
          :loading="props.pending"
          :label="t('hrAssets.custody.assign')"
          data-testid="hr-asset-assign"
          @click="assign"
        />
      </div>
    </div>
    <p v-else-if="props.canManage" class="mt-3 text-sm text-muted">{{ t('hrAssets.custody.assignedHint') }}</p>
  </SharedRecordSection>
</template>
