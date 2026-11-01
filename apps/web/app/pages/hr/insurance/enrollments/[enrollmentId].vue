<script setup lang="ts">
import DependentsSection from '@/components/hr/insurance/DependentsSection.vue'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { isHrInsuranceConflict } from '@/composables/useHrInsurance'
import { owningListBack } from '@/utils/recordListOrigin'
import { canChangeHrInsuranceEnrollment, hrInsuranceEnrollmentBadge, hrInsurancePlanBadge } from '@/utils/hrInsurance'

const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/insurance'])
const id = computed(() => Number(route.params.enrollmentId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrInsuranceEnrollment(computed(() => (validId.value ? id.value : null)))
const enrollment = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const settings = useHrInsuranceSettings()

const canManage = computed(() => can('hr.insurance.manage'))
const changeable = computed(() => !!enrollment.value && canChangeHrInsuranceEnrollment(enrollment.value, canManage.value))
const step = useStepHrInsuranceEnrollment()
const patch = usePatchHrInsuranceEnrollment()
// null: nothing open; otherwise the inline confirmation that is showing.
const confirming = ref<'end' | 'cancel' | null>(null)
const endDate = ref<string | null>(null)
const actionError = ref('')

const badge = computed(() => (enrollment.value ? hrInsuranceEnrollmentBadge(enrollment.value.state) : null))
const planBadge = computed(() => (enrollment.value ? hrInsurancePlanBadge(enrollment.value.plan.state) : null))
const number = (value: number | null) => (value === null ? null : new Intl.NumberFormat(locale.value).format(value))

// The shares and the notes are the only editable fields, saved with the revision read.
const employeeShare = ref<number | undefined>()
const companyShare = ref<number | undefined>()
const notes = ref('')
const editing = ref(false)
function startEdit() {
  const current = enrollment.value
  if (!current) return
  employeeShare.value = current.employee_share ?? undefined
  companyShare.value = current.company_share ?? undefined
  notes.value = current.notes ?? ''
  actionError.value = ''
  editing.value = true
}
function failed(cause: unknown) {
  actionError.value = isHrInsuranceConflict(cause) ? t('hrInsurance.conflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
  confirming.value = null
}
async function saveEdit() {
  const current = enrollment.value
  if (!current || !hydrated.value || patch.isPending.value) return
  actionError.value = ''
  try {
    await patch.mutateAsync({ id: current.id, body: { revision: current.revision, employee_share: employeeShare.value ?? 0, company_share: companyShare.value ?? 0, notes: notes.value.trim() } })
    editing.value = false
  } catch (cause) { failed(cause) }
}
async function confirmStep() {
  const current = enrollment.value
  const kind = confirming.value
  if (!current || !kind || !hydrated.value || step.isPending.value) return
  actionError.value = ''
  try {
    await step.mutateAsync({ id: current.id, step: kind, revision: current.revision, dateEnd: endDate.value ?? undefined })
    confirming.value = null
    endDate.value = null
  } catch (cause) { failed(cause) }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!enrollment"
    :title="enrollment ? `${enrollment.employee.name} · ${enrollment.plan.name}` : t('hrInsurance.title')"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="changeable && !confirming && !editing" #actions>
      <UButton color="neutral" variant="outline" :disabled="!hydrated" :label="t('hrInsurance.actions.edit')" data-testid="hr-insurance-edit" @click="startEdit" />
      <UButton color="error" variant="outline" :disabled="!hydrated" :label="t('hrInsurance.actions.end')" data-testid="hr-insurance-end" @click="confirming = 'end'" />
      <UButton color="neutral" variant="ghost" :disabled="!hydrated" :label="t('hrInsurance.actions.cancel')" data-testid="hr-insurance-cancel" @click="confirming = 'cancel'" />
    </template>

    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="t('hrInsurance.actions.error')" :description="actionError" data-testid="hr-insurance-action-error" />

    <SharedInlineConfirm
      v-if="confirming"
      :title="t(confirming === 'end' ? 'hrInsurance.actions.endTitle' : 'hrInsurance.actions.cancelTitle')"
      :description="t(confirming === 'end' ? 'hrInsurance.actions.endHint' : 'hrInsurance.actions.cancelHint')"
      :confirm-label="t(confirming === 'end' ? 'hrInsurance.actions.end' : 'hrInsurance.actions.cancelConfirm')"
      :cancel-label="t('app.back')"
      :pending="step.isPending.value"
      @confirm="confirmStep"
      @cancel="confirming = null"
    >
      <UFormField v-if="confirming === 'end'" :label="t('hrInsurance.actions.endDate')" for="hr-insurance-end-date" class="mt-2" :hint="t('hrInsurance.actions.endDateHint')">
        <SharedDateField id="hr-insurance-end-date" v-model="endDate" :disabled="step.isPending.value" />
      </UFormField>
    </SharedInlineConfirm>

    <SharedIdentityCard v-if="enrollment" :id="enrollment.id" :name="enrollment.employee.name" :subtitle="`${enrollment.plan.name} · ${enrollment.plan.provider.name}`">
      <template v-if="badge" #badge>
        <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" data-testid="hr-insurance-state" />
      </template>
    </SharedIdentityCard>

    <SharedRecordSection v-if="enrollment" variant="panel" :title="t('hrInsurance.detail.cover')">
      <form v-if="editing" class="grid gap-4" data-testid="hr-insurance-edit-form" @submit.prevent="saveEdit">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrInsurance.form.employeeShare')" name="hr-insurance-edit-employee-share"><UInputNumber v-model="employeeShare" class="w-full" :min="0" :disabled="patch.isPending.value" /></UFormField>
          <UFormField :label="t('hrInsurance.form.companyShare')" name="hr-insurance-edit-company-share"><UInputNumber v-model="companyShare" class="w-full" :min="0" :disabled="patch.isPending.value" /></UFormField>
        </div>
        <UFormField :label="t('hrInsurance.form.notes')" name="hr-insurance-edit-notes"><UTextarea v-model="notes" class="w-full" :rows="3" :disabled="patch.isPending.value" /></UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="patch.isPending.value" :label="t('app.cancel')" @click="editing = false" />
          <UButton type="submit" color="primary" :loading="patch.isPending.value" :disabled="!hydrated" :label="t('app.saveChanges')" data-testid="hr-insurance-edit-save" />
        </div>
      </form>
      <dl v-else class="grid gap-x-6 sm:grid-cols-2">
        <SharedPropertyRow :label="t('hrInsurance.detail.coverage')" :value="`${formatDate(enrollment.date_from)} – ${formatDate(enrollment.date_end)}`" />
        <SharedPropertyRow :label="t('hrInsurance.detail.memberNumber')">
          <bdi v-if="enrollment.member_number" dir="ltr" data-testid="hr-insurance-member-number">{{ enrollment.member_number }}</bdi>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('hrInsurance.detail.employeeShare')" :value="number(enrollment.employee_share)" />
        <SharedPropertyRow :label="t('hrInsurance.detail.companyShare')" :value="number(enrollment.company_share)" />
        <SharedPropertyRow :label="t('hrInsurance.detail.notes')" :value="enrollment.notes" />
      </dl>
      <p v-if="!editing" class="mt-3 text-xs text-muted">{{ t('hrInsurance.detail.sharesNote') }}</p>
    </SharedRecordSection>

    <DependentsSection
      v-if="enrollment"
      :enrollment-id="enrollment.id"
      :dependents="enrollment.dependents"
      :can-edit="changeable"
      :require-id="settings.data.value?.insurance_require_dependent_id ?? false"
      :from="enrollment.date_from"
      :to="enrollment.date_end"
    />

    <template v-if="enrollment" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrInsurance.detail.employee')" :value="enrollment.employee.name" />
        <SharedPropertyRow :label="t('hrInsurance.detail.plan')">
          <NuxtLink :to="`/hr/insurance/plans/${enrollment.plan.id}`" class="text-primary">{{ enrollment.plan.name }}</NuxtLink>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('hrInsurance.detail.provider')" :value="enrollment.plan.provider.name" />
        <SharedPropertyRow :label="t('hrInsurance.detail.tier')" :value="enrollment.plan.tier" />
        <SharedPropertyRow :label="t('hrInsurance.detail.planValidity')" :value="`${formatDate(enrollment.plan.valid_from)} – ${formatDate(enrollment.plan.valid_to)}`" />
        <SharedPropertyRow :label="t('hrInsurance.detail.planState')">
          <SharedStatusBadge v-if="planBadge" size="sm" :tone="planBadge.tone" :label="t(planBadge.labelKey)" />
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
