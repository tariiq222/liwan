<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrRef, HrWarning, HrWarningType } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { sortHrWarningTypes } from '@/utils/hrWarnings'
import WarningStandingNote from './WarningStandingNote.vue'

// The create form of one warning, inside the /hr/warnings/new SharedCreatePanel. It posts the exact
// request body, shows the chosen employee's standing, and reports the created draft; the page owns the navigation.
const props = defineProps<{
  employees: HrRef[]
  types: HrWarningType[]
  backTo: RouteLocationRaw
}>()
const emit = defineEmits<{ saved: [warning: HrWarning] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createWarning, isPending } = useCreateHrWarning()

const employeeId = ref<number | null>(null)
const typeId = ref<number | null>(null)
const dateIssued = ref<string | null>(null)
const reason = ref('')
const corrective = ref('')
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const standing = useHrWarningStanding(employeeId)
const employeeOptions = computed(() => props.employees.map(employee => ({ value: String(employee.id), label: employee.name })))
const typeOptions = computed(() => sortHrWarningTypes(props.types).map(type => ({
  value: String(type.id),
  label: `${type.name} (${t('hrWarnings.severity', { severity: type.severity })})`,
})))
const dirty = computed(() => !saved.value && Boolean(employeeId.value || typeId.value || dateIssued.value || reason.value || corrective.value))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const employeeError = computed(() => attempted.value && !employeeId.value ? t('hrWarnings.form.employeeRequired') : fieldError('employee_id'))
const typeError = computed(() => attempted.value && !typeId.value ? t('hrWarnings.form.typeRequired') : fieldError('type_id'))
const reasonError = computed(() => attempted.value && !reason.value.trim() ? t('hrWarnings.form.reasonRequired') : fieldError('reason'))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!employeeId.value || !typeId.value || !reason.value.trim()) return
  try {
    const warning = await createWarning({
      employee_id: employeeId.value,
      type_id: typeId.value,
      date_issued: dateIssued.value ?? undefined,
      reason: reason.value.trim(),
      corrective_action: corrective.value.trim() || undefined,
    })
    saved.value = true
    await nextTick()
    emit('saved', warning)
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <UForm novalidate :state="{ employeeId, typeId, dateIssued, reason, corrective }" class="liwan-form" method="post" data-testid="hr-warning-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection panel :title="t('hrWarnings.form.details')">
      <div class="grid gap-4">
        <UFormField :label="t('hrWarnings.form.employee')" name="hr-warning-employee" required :error="employeeError">
          <USelect
            id="hr-warning-employee"
            class="w-full"
            :model-value="employeeId ? String(employeeId) : undefined"
            :items="employeeOptions"
            :placeholder="t('hrWarnings.form.chooseEmployee')"
            :disabled="!hydrated || isPending"
            data-testid="hr-warning-employee"
            @update:model-value="employeeId = $event ? Number($event) : null"
          />
        </UFormField>
        <WarningStandingNote v-if="employeeId" :standing="standing.data.value" />
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrWarnings.form.type')" name="hr-warning-type" required :error="typeError" :hint="typeOptions.length ? undefined : t('hrWarnings.form.noTypes')">
            <USelect
              id="hr-warning-type"
              class="w-full"
              :model-value="typeId ? String(typeId) : undefined"
              :items="typeOptions"
              :placeholder="t('hrWarnings.form.chooseType')"
              :disabled="!hydrated || isPending"
              data-testid="hr-warning-type"
              @update:model-value="typeId = $event ? Number($event) : null"
            />
          </UFormField>
          <UFormField :label="t('hrWarnings.form.date')" name="hr-warning-date" :hint="t('hrWarnings.form.dateHint')">
            <SharedDateField id="hr-warning-date" v-model="dateIssued" :disabled="!hydrated || isPending" />
          </UFormField>
        </div>
        <UFormField :label="t('hrWarnings.form.reason')" name="hr-warning-reason" required :error="reasonError">
          <UTextarea id="hr-warning-reason" v-model="reason" class="w-full" :rows="4" :placeholder="t('hrWarnings.form.reasonPlaceholder')" :disabled="!hydrated || isPending" data-testid="hr-warning-reason" />
        </UFormField>
        <UFormField :label="t('hrWarnings.form.corrective')" name="hr-warning-corrective" :hint="t('hrWarnings.form.correctiveHint')">
          <UTextarea id="hr-warning-corrective" v-model="corrective" class="w-full" :rows="3" :disabled="!hydrated || isPending" data-testid="hr-warning-corrective" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('hrWarnings.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrWarnings.form.submit')" data-testid="hr-warning-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
