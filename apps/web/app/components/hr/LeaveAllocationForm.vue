<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { localIsoDay } from '@webvue/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { useCreateLeaveAllocation, useHrLeaveTypes, useUpdateLeaveAllocation, type HrLeaveAllocation } from '@/composables/useHrLeave'

// Grants days (`/hr/leave/allocations/new`) or, given an `allocation`, corrects its days and
// validity in place on the record page; the employee and the leave type of a grant never change.
const props = defineProps<{ backTo: RouteLocationRaw; allocation?: HrLeaveAllocation }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const editing = computed(() => !!props.allocation)
const editHint = computed(() => props.allocation
  ? t('hr.leave.allocation.editHint', { employee: props.allocation.employee.name, type: props.allocation.leave_type.name })
  : undefined)
const types = useHrLeaveTypes(computed(() => !editing.value))
const employeeSearch = ref('')
const debouncedSearch = refDebounced(employeeSearch, 250)
const employees = useHrEmployees(computed(() => ({ q: debouncedSearch.value.trim() || undefined, limit: 50 })), computed(() => !editing.value))
const create = useCreateLeaveAllocation()
const update = useUpdateLeaveAllocation()
const isPending = computed(() => create.isPending.value || update.isPending.value)

const employeeId = ref<number | null>(props.allocation?.employee.id ?? null)
const leaveTypeId = ref<number | null>(props.allocation?.leave_type.id ?? null)
const days = ref<number | null>(props.allocation?.number_of_days ?? null)
const dateFrom = ref<string | null>(props.allocation?.date_from ?? null)
// Filled after hydration from the browser's own day: toISOString would give the UTC day,
// which is the previous date in Riyadh between 00:00 and 03:00.
onMounted(() => { dateFrom.value ??= localIsoDay() })
const dateTo = ref<string | null>(props.allocation?.date_to ?? null)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

// Only leave types that hold a balance can receive days.
const typeOptions = computed(() => (types.data.value?.items ?? [])
  .filter(type => type.requires_allocation)
  .map(type => ({ value: String(type.id), label: type.name })))
const employeeOptions = computed(() => (employees.data.value?.items ?? []).map(employee => ({ value: String(employee.id), label: employee.name })))
const dirty = computed(() => {
  if (saved.value) return false
  if (!props.allocation) return Boolean(employeeId.value || leaveTypeId.value || days.value)
  return days.value !== props.allocation.number_of_days || dateFrom.value !== props.allocation.date_from || dateTo.value !== props.allocation.date_to
})

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const employeeError = computed(() => attempted.value && !employeeId.value ? t('hr.leave.allocation.employeeRequired') : fieldError('employee_id'))
const typeError = computed(() => attempted.value && !leaveTypeId.value ? t('hr.leave.form.typeRequired') : fieldError('leave_type_id'))
const daysError = computed(() => attempted.value && !(days.value && days.value > 0) ? t('hr.leave.allocation.daysRequired') : fieldError('number_of_days'))
const fromError = computed(() => attempted.value && !dateFrom.value ? t('hr.leave.form.dateRequired') : fieldError('date_from'))
const toError = computed(() => dateFrom.value && dateTo.value && dateTo.value < dateFrom.value ? t('hr.leave.form.dateOrder') : fieldError('date_to'))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!employeeId.value || !leaveTypeId.value || !(days.value && days.value > 0) || !dateFrom.value || toError.value) return
  try {
    if (props.allocation) {
      await update.mutateAsync({ id: props.allocation.id, patch: { number_of_days: days.value, date_from: dateFrom.value, date_to: dateTo.value } })
    } else {
      await create.mutateAsync({
        employee_id: employeeId.value,
        leave_type_id: leaveTypeId.value,
        number_of_days: days.value,
        date_from: dateFrom.value,
        date_to: dateTo.value,
      })
    }
    saved.value = true
    await nextTick()
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <SharedPageState :loading="!editing && types.isLoading.value" :error="editing ? null : types.error.value" :empty="!editing && !types.isLoading.value && !typeOptions.length" :empty-text="t('hr.leave.allocation.noTypes')" @retry="types.refetch">
    <UForm novalidate :state="{ employeeId, leaveTypeId, days, dateFrom, dateTo }" class="webvue-form" method="post" data-testid="hr-leave-allocation-form" @submit="submit">
      <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
      <SharedFormSection panel :title="t('hr.leave.allocation.details')" :description="editHint">
        <div class="grid gap-4">
          <UFormField v-if="!props.allocation" :label="t('hr.leave.allocation.employee')" name="hr-allocation-employee-search" required :error="employeeError">
            <div class="grid gap-2">
              <UInput id="hr-allocation-employee-search" v-model="employeeSearch" class="w-full" icon="i-lucide-search" :placeholder="t('hr.leave.allocation.employeeSearch')" :aria-label="t('hr.leave.allocation.employeeSearch')" :disabled="!hydrated || isPending" />
              <UAlert v-if="employees.error.value" role="alert" color="error" variant="subtle" :title="t('hr.leave.allocation.employeesError')">
                <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :label="t('app.retry')" @click="employees.refetch()" /></template>
              </UAlert>
              <USelect
                id="hr-allocation-employee"
                class="w-full"
                :model-value="employeeId ? String(employeeId) : undefined"
                :items="employeeOptions"
                :placeholder="t('hr.leave.allocation.chooseEmployee')"
                :aria-label="t('hr.leave.allocation.employee')"
                :disabled="!hydrated || isPending"
                data-testid="hr-allocation-employee"
                @update:model-value="employeeId = $event ? Number($event) : null"
              />
            </div>
          </UFormField>
          <UFormField v-if="!props.allocation" :label="t('hr.leave.form.type')" name="hr-allocation-type" required :error="typeError">
            <USelect
              id="hr-allocation-type"
              class="w-full"
              :model-value="leaveTypeId ? String(leaveTypeId) : undefined"
              :items="typeOptions"
              :placeholder="t('hr.leave.form.chooseType')"
              :disabled="!hydrated || isPending"
              data-testid="hr-allocation-type"
              @update:model-value="leaveTypeId = $event ? Number($event) : null"
            />
          </UFormField>
          <UFormField :label="t('hr.leave.allocation.days')" name="hr-allocation-days" required :error="daysError">
            <UInputNumber id="hr-allocation-days" v-model="days" class="w-full" :min="0.5" :step="0.5" :disabled="!hydrated || isPending" data-testid="hr-allocation-days" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hr.leave.allocation.validFrom')" name="hr-allocation-from" required :error="fromError">
              <SharedDateField id="hr-allocation-from" v-model="dateFrom" :disabled="!hydrated || isPending" />
            </UFormField>
            <UFormField :label="t('hr.leave.allocation.validTo')" name="hr-allocation-to" :error="toError" :hint="t('hr.leave.allocation.validToHint')">
              <SharedDateField id="hr-allocation-to" v-model="dateTo" :min-value="dateFrom" :disabled="!hydrated || isPending" />
            </UFormField>
          </div>
        </div>
      </SharedFormSection>
      <SharedFormActions>
        <span class="text-xs text-muted">{{ t('hr.leave.form.requiredHint') }}</span>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t(props.allocation ? 'hr.leave.allocation.save' : 'hr.leave.allocation.submit')" data-testid="hr-allocation-submit" />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedPageState>
</template>
