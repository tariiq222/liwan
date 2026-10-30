<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { refDebounced } from '@vueuse/core'
import { useCreateLeaveRequest, useHrLeaveTypes } from '@/composables/useHrLeave'
import { useHrEmployees } from '@/composables/useHrEmployees'

const props = defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const types = useHrLeaveTypes()
const { mutateAsync: create, isPending } = useCreateLeaveRequest()

// Leave managers may file a request for another employee; everyone else files their own.
const canFileForOthers = computed(() => can('hr.leave.manage'))
const employeeSearch = ref('')
const debouncedSearch = refDebounced(employeeSearch, 250)
const employees = useHrEmployees(computed(() => ({ q: debouncedSearch.value.trim() || undefined, limit: 50 })), canFileForOthers)
const employeeId = ref<number | null>(null)
const OWN = 'own'
const employeeOptions = computed(() => [
  { value: OWN, label: t('hr.leave.form.onBehalfSelf') },
  ...(employees.data.value?.items ?? []).map(employee => ({ value: String(employee.id), label: employee.name })),
])
const leaveTypeId = ref<number | null>(null)
const dateFrom = ref<string | null>(null)
const dateTo = ref<string | null>(null)
const notes = ref('')
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const typeOptions = computed(() => (types.data.value?.items ?? []).map(type => ({ value: String(type.id), label: type.name })))
const selectedType = computed(() => types.data.value?.items.find(type => type.id === leaveTypeId.value) ?? null)
const dirty = computed(() => !saved.value && Boolean(employeeId.value || leaveTypeId.value || dateFrom.value || dateTo.value || notes.value.trim()))

const typeError = computed(() => attempted.value && !leaveTypeId.value ? t('hr.leave.form.typeRequired') : fieldError('leave_type_id'))
const fromError = computed(() => attempted.value && !dateFrom.value ? t('hr.leave.form.dateRequired') : fieldError('date_from'))
const toError = computed(() => {
  if (attempted.value && !dateTo.value) return t('hr.leave.form.dateRequired')
  if (dateFrom.value && dateTo.value && dateTo.value < dateFrom.value) return t('hr.leave.form.dateOrder')
  return fieldError('date_to')
})
function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}

function pickType(value: unknown) {
  leaveTypeId.value = value ? Number(value) : null
}
function pickFrom(value: string | null) {
  dateFrom.value = value
  if (value && (!dateTo.value || dateTo.value < value)) dateTo.value = value
}

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!leaveTypeId.value || !dateFrom.value || !dateTo.value || dateTo.value < dateFrom.value) return
  try {
    await create({
      ...(employeeId.value ? { employee_id: employeeId.value } : {}),
      leave_type_id: leaveTypeId.value,
      date_from: dateFrom.value,
      date_to: dateTo.value,
      notes: notes.value.trim() || undefined,
    })
    saved.value = true
    await nextTick()
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof ApiError ? (cause.code === 'leave_overlap' ? t('hr.leave.form.overlap') : cause.message) : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <SharedPageState :loading="types.isLoading.value" :error="types.error.value" :empty="!types.isLoading.value && !typeOptions.length" :empty-text="t('hr.leave.form.noTypes')" @retry="types.refetch">
    <UForm novalidate :state="{ employeeId, leaveTypeId, dateFrom, dateTo, notes }" class="webvue-form" method="post" data-testid="hr-leave-request-form" @submit="submit">
      <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
      <SharedFormSection panel :title="t('hr.leave.form.details')">
        <div class="grid gap-4">
          <UFormField v-if="canFileForOthers" :label="t('hr.leave.form.onBehalf')" name="hr-leave-employee" :error="fieldError('employee_id')">
            <div class="grid gap-2">
              <UInput id="hr-leave-employee-search" v-model="employeeSearch" class="w-full" icon="i-lucide-search" :placeholder="t('hr.leave.form.employeeSearch')" :aria-label="t('hr.leave.form.employeeSearch')" :disabled="!hydrated || isPending" />
              <USelect
                id="hr-leave-employee"
                class="w-full"
                :model-value="employeeId ? String(employeeId) : OWN"
                :items="employeeOptions"
                :aria-label="t('hr.leave.form.onBehalf')"
                :disabled="!hydrated || isPending"
                data-testid="hr-leave-employee"
                @update:model-value="employeeId = $event && $event !== OWN ? Number($event) : null"
              />
            </div>
          </UFormField>
          <UFormField :label="t('hr.leave.form.type')" name="hr-leave-type" required :error="typeError">
            <USelect
              id="hr-leave-type"
              class="w-full"
              :model-value="leaveTypeId ? String(leaveTypeId) : undefined"
              :items="typeOptions"
              :placeholder="t('hr.leave.form.chooseType')"
              :disabled="!hydrated || isPending"
              data-testid="hr-leave-type"
              @update:model-value="pickType"
            />
          </UFormField>
          <p v-if="selectedType?.support_document" class="text-sm text-muted">{{ t('hr.leave.form.documentHint') }}</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hr.leave.form.from')" name="hr-leave-from" required :error="fromError">
              <SharedDateField id="hr-leave-from" :model-value="dateFrom" :disabled="!hydrated || isPending" data-testid="hr-leave-from" @update:model-value="pickFrom" />
            </UFormField>
            <UFormField :label="t('hr.leave.form.to')" name="hr-leave-to" required :error="toError">
              <SharedDateField id="hr-leave-to" v-model="dateTo" :min-value="dateFrom" :disabled="!hydrated || isPending" data-testid="hr-leave-to" />
            </UFormField>
          </div>
          <UFormField :label="t('hr.leave.form.notes')" name="hr-leave-notes">
            <UTextarea id="hr-leave-notes" v-model="notes" class="w-full" :rows="3" :disabled="!hydrated || isPending" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormActions>
        <span class="text-xs text-muted">{{ t('hr.leave.form.requiredHint') }}</span>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hr.leave.form.submit')" data-testid="hr-leave-submit" />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedPageState>
</template>
