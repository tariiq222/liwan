<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrDeparture } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { ApiError } from '@/composables/useApi'
import { useHrEmployees } from '@/composables/useHrEmployees'
import {
  useHrDepartureReasons,
  useHrOffboardingPlans,
  usePatchHrDeparture,
  useRegisterHrDeparture,
} from '@/composables/useHrOffboarding'

// Registering a departure (employee, last day, reason, optional clearance plan) and
// patching the departure fields of an existing record. The engine is the stock
// hr.departure.wizard; archiving stays on the employee archive action.
const props = defineProps<{
  namespace: string
  departure?: HrDeparture | null
  backTo: RouteLocationRaw
}>()
const emit = defineEmits<{ saved: [departure: HrDeparture] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const formError = ref<unknown>(null)
const errorMessage = computed(() => formError.value
  ? saveErrorMessage(formError.value, t(`${props.namespace}.form.saveError`), t('errors.saveUncertain'))
  : undefined)
const canManage = computed(() => can('hr.offboarding.manage'))
const employees = useHrEmployees({ limit: 200, offset: 0 })
const reasons = useHrDepartureReasons()
const plans = useHrOffboardingPlans({ active: 'true', limit: 200, offset: 0 })

const employeeId = ref<number | null>(props.departure?.employee.id ?? null)
const departureDate = ref<string | null>(props.departure?.departure_date ?? null)
const reasonId = ref<number | null>(props.departure?.reason?.id ?? null)
const description = ref(props.departure?.description ?? '')
const setContractEnd = ref(true)
const planId = ref<number | null>(null)
// The draft against the record it started from. A registration is released just before `saved` lets the
// page navigate away; an edited record stays guarded, its baseline following the refreshed departure.
const saved = ref(false)
const dirty = computed(() => !saved.value && (
  employeeId.value !== (props.departure?.employee.id ?? null)
  || departureDate.value !== (props.departure?.departure_date ?? null)
  || reasonId.value !== (props.departure?.reason?.id ?? null)
  || description.value !== (props.departure?.description ?? '')
  || !setContractEnd.value
  || planId.value !== null
))
const employeeError = ref<string>()
const dateError = ref<string>()
const reasonError = ref<string>()

const employeeOptions = computed(() => (employees.data.value?.items ?? [])
  .map(employee => ({ value: String(employee.id), label: employee.name })))
const reasonOptions = computed(() => (reasons.data.value?.items ?? [])
  .map(reason => ({ value: String(reason.id), label: reason.name })))
const planOptions = computed(() => [
  { value: 'none', label: t(`${props.namespace}.form.noClearancePlan`) },
  ...(plans.data.value?.items ?? []).map(plan => ({ value: String(plan.id), label: plan.name })),
])

const { mutateAsync: register, isPending: registering } = useRegisterHrDeparture()
const { mutateAsync: patch, isPending: patching } = usePatchHrDeparture()
const pending = computed(() => registering.value || patching.value)

function fieldError(field: string) {
  if (field === 'employee_id' && employeeError.value) return employeeError.value
  if (field === 'departure_date' && dateError.value) return dateError.value
  if (field === 'departure_reason_id' && reasonError.value) return reasonError.value
  return formError.value instanceof ApiError && formError.value.field === field ? formError.value.message : undefined
}

let submitting = false
async function submit() {
  if (!canManage.value || !hydrated.value || pending.value || submitting) return
  employeeError.value = undefined
  dateError.value = undefined
  reasonError.value = undefined
  if (!props.departure && !employeeId.value) {
    employeeError.value = t(`${props.namespace}.form.employeeRequired`)
    return
  }
  if (!departureDate.value) {
    dateError.value = t(`${props.namespace}.form.departureDate`)
    return
  }
  if (!reasonId.value) {
    reasonError.value = t(`${props.namespace}.form.departureReasonRequired`)
    return
  }
  submitting = true
  try {
    const departure = props.departure
      ? await patch({
        employeeId: props.departure.employee.id,
        patch: { departure_date: departureDate.value, departure_reason_id: reasonId.value, description: description.value },
      })
      : await register({
        employee_id: employeeId.value as number,
        departure_date: departureDate.value,
        departure_reason_id: reasonId.value,
        description: description.value,
        set_contract_end: setContractEnd.value,
        plan_id: planId.value,
      })
    formError.value = null
    if (!props.departure) {
      saved.value = true
      await nextTick()
    }
    emit('saved', departure)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ employeeId, departureDate, reasonId, description }" class="webvue-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="t(`${namespace}.form.saveError`)" :description="errorMessage" />
    <SharedFormSection panel :title="t(`${namespace}.departures.title`)">
      <div class="webvue-form-grid">
        <UFormField v-if="!departure" :label="t(`${namespace}.form.employee`)" name="hr-departure-employee" required :error="fieldError('employee_id')">
          <USelect
            id="hr-departure-employee"
            class="w-full"
            :model-value="employeeId ? String(employeeId) : undefined"
            :items="employeeOptions"
            :placeholder="t(`${namespace}.form.employeePlaceholder`)"
            :disabled="!canManage || !hydrated || pending"
            @update:model-value="employeeId = $event ? Number($event) : null"
          />
        </UFormField>
        <UFormField :label="t(`${namespace}.form.departureDate`)" name="hr-departure-date" required :error="fieldError('departure_date')">
          <SharedDateField id="hr-departure-date" v-model="departureDate" class="w-full" :disabled="!canManage || !hydrated || pending" />
        </UFormField>
        <UFormField :label="t(`${namespace}.form.departureReason`)" name="hr-departure-reason" required :error="fieldError('departure_reason_id')">
          <USelect
            id="hr-departure-reason"
            class="w-full"
            :model-value="reasonId ? String(reasonId) : undefined"
            :items="reasonOptions"
            :disabled="!canManage || !hydrated || pending"
            @update:model-value="reasonId = $event ? Number($event) : null"
          />
        </UFormField>
        <UFormField v-if="!departure" :label="t(`${namespace}.form.clearancePlan`)" name="hr-departure-plan">
          <USelect
            id="hr-departure-plan"
            class="w-full"
            :model-value="planId ? String(planId) : 'none'"
            :items="planOptions"
            :disabled="!canManage || !hydrated || pending"
            @update:model-value="planId = !$event || $event === 'none' ? null : Number($event)"
          />
        </UFormField>
        <UFormField :label="t(`${namespace}.form.description`)" name="hr-departure-description" class="md:col-span-2">
          <UTextarea v-model="description" class="w-full" :rows="3" :disabled="!canManage || !hydrated || pending" />
        </UFormField>
        <UFormField v-if="!departure" :label="t(`${namespace}.form.setContractEnd`)" name="hr-departure-contract-end">
          <UCheckbox v-model="setContractEnd" :disabled="!canManage || !hydrated || pending" :label="t(`${namespace}.form.setContractEnd`)" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!canManage || !hydrated || pending" :loading="pending" :label="t(props.departure ? 'app.saveChanges' : 'app.create')" />
    </SharedFormActions>
  </UForm>
</template>
