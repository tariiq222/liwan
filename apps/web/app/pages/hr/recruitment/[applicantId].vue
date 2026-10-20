<script setup lang="ts">
import { formatDate, formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'
import {
  HR_APPLICANT_PRIORITIES,
  hrApplicantBadge,
  hrApplicantPriorityKey,
  type HrApplicantPriority,
} from '@/composables/useHrRecruitment'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/recruitment'])
const id = computed(() => Number(route.params.applicantId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrRecruitmentApplicant(computed(() => (validId.value ? id.value : null)))
const applicant = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const canManage = computed(() => can('hr.recruitment.manage'))
const canHire = computed(() => can('hr.recruitment.manage') && can('hr.employees.manage'))
const stages = useHrRecruitmentStages(computed(() => applicant.value?.job?.id ?? null))
const refuseReasons = useHrRecruitmentRefuseReasons()
const update = useUpdateHrApplicant()
const refusal = useRefuseHrApplicant()
const reset = useResetHrApplicant()
const hire = useHireHrApplicant()

const writing = computed(() => update.isPending.value || refusal.isPending.value || reset.isPending.value || hire.isPending.value)
const actionError = ref('')
const refusing = ref(false)
const resetting = ref(false)
const hiring = ref(false)
const refuseReasonId = ref<number | null>(null)
// Set once this page hired the applicant: the success notice and the next step stay until the page is left.
const hiredEmployee = ref<{ id: number; name: string } | null>(null)
const canStartOnboarding = computed(() => can('hr.onboarding.manage'))

// The stages come from a query that depends on the applicant's job, so it may not be in the first client render; the
// applicant's own stage is always an option, which keeps the select's label the same on the server and the client.
const stageOptions = computed(() => {
  const options = (stages.data.value?.items ?? []).map(stage => ({ value: String(stage.id), label: stage.name }))
  const current = applicant.value?.stage
  return current && !options.some(option => option.value === String(current.id))
    ? [{ value: String(current.id), label: current.name }, ...options]
    : options
})
const reasonOptions = computed(() => (refuseReasons.data.value?.items ?? []).map(reason => ({ value: String(reason.id), label: reason.name })))
const priorityOptions = computed(() => HR_APPLICANT_PRIORITIES.map(priority => ({
  value: priority,
  label: t(hrApplicantPriorityKey(priority)),
})))

// The record page only offers the actions the engine still accepts: a hired applicant has
// nothing left to hire, and a refused or archived one is not in the pipeline.
const openToPipeline = computed(() => !!applicant.value?.active && !applicant.value?.refuse_reason)

async function run(action: () => Promise<unknown>) {
  if (!hydrated.value || writing.value) return
  actionError.value = ''
  try {
    await action()
  } catch (cause) {
    actionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
function priorityValue(value: string): HrApplicantPriority {
  return HR_APPLICANT_PRIORITIES.find(candidate => candidate === value) ?? '0'
}
async function changeStage(value: string) {
  await run(() => update.mutateAsync({ id: id.value, body: { stage_id: Number(value) } }))
}
async function changePriority(value: string) {
  await run(() => update.mutateAsync({ id: id.value, body: { priority: priorityValue(value) } }))
}
async function confirmRefuse() {
  const reasonId = refuseReasonId.value
  if (!reasonId) return
  await run(async () => {
    await refusal.mutateAsync({ id: id.value, refuseReasonId: reasonId })
    refusing.value = false
  })
}
async function confirmReset() {
  await run(async () => {
    await reset.mutateAsync(id.value)
    resetting.value = false
  })
}
async function confirmHire() {
  await run(async () => {
    const result = await hire.mutateAsync(id.value)
    hiredEmployee.value = result.employee
    hiring.value = false
  })
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!applicant"
    :title="applicant?.partner_name || t('hrRecruitment.title')"
    :description="applicant?.job?.name"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="applicant && canManage" #actions>
      <UButton
        v-if="openToPipeline && !applicant.employee && canHire"
        color="primary"
        :disabled="!hydrated || writing"
        :label="t('hrRecruitment.hire.action')"
        data-testid="hr-recruitment-hire"
        @click="hiring = true"
      />
      <UButton
        v-if="openToPipeline"
        color="neutral"
        variant="outline"
        :disabled="!hydrated || writing"
        :label="t('hrRecruitment.reset.action')"
        data-testid="hr-recruitment-reset"
        @click="resetting = true"
      />
      <UButton
        v-if="openToPipeline"
        color="error"
        variant="outline"
        :disabled="!hydrated || writing"
        :label="t('hrRecruitment.refuse.action')"
        data-testid="hr-recruitment-refuse"
        @click="refusing = true"
      />
    </template>

    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" data-testid="hr-recruitment-action-error" />

    <UAlert
      v-if="hiredEmployee"
      role="status"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check"
      data-testid="hr-recruitment-hired"
      :title="t('hrRecruitment.hire.done', { name: hiredEmployee.name })"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" :to="`/hr/employees/${hiredEmployee.id}`" :label="hiredEmployee.name" data-testid="hr-recruitment-hired-employee" />
        <UButton
          v-if="canStartOnboarding"
          color="primary"
          :to="{ path: '/hr/onboarding/new', query: { employee_id: String(hiredEmployee.id) } }"
          :label="t('hrRecruitment.hire.startOnboarding')"
          data-testid="hr-recruitment-start-onboarding"
        />
      </template>
    </UAlert>

    <SharedInlineConfirm
      v-if="refusing"
      :title="t('hrRecruitment.refuse.confirmTitle')"
      :confirm-label="t('hrRecruitment.refuse.action')"
      :pending="refusal.isPending.value"
      :disabled="!hydrated || !refuseReasonId"
      color="error"
      @confirm="confirmRefuse"
      @cancel="refusing = false"
    >
      <UFormField :label="t('hrRecruitment.refuse.reason')" for="hr-recruitment-refuse-reason">
        <USelect
          id="hr-recruitment-refuse-reason"
          class="w-full"
          :model-value="refuseReasonId ? String(refuseReasonId) : undefined"
          :items="reasonOptions"
          :placeholder="t('hrRecruitment.refuse.chooseReason')"
          :disabled="!hydrated || refusal.isPending.value"
          data-testid="hr-recruitment-refuse-reason"
          @update:model-value="refuseReasonId = $event ? Number($event) : null"
        />
      </UFormField>
    </SharedInlineConfirm>
    <SharedInlineConfirm
      v-if="resetting"
      :title="t('hrRecruitment.reset.confirmTitle')"
      :description="t('hrRecruitment.reset.confirmHint')"
      :confirm-label="t('hrRecruitment.reset.action')"
      :pending="reset.isPending.value"
      :disabled="!hydrated"
      @confirm="confirmReset"
      @cancel="resetting = false"
    />
    <SharedInlineConfirm
      v-if="hiring"
      :title="t('hrRecruitment.hire.confirmTitle', { name: applicant?.partner_name ?? '' })"
      :description="t('hrRecruitment.hire.confirmHint')"
      :confirm-label="t('hrRecruitment.hire.action')"
      :pending="hire.isPending.value"
      :disabled="!hydrated"
      color="primary"
      @confirm="confirmHire"
      @cancel="hiring = false"
    />

    <SharedIdentityCard
      v-if="applicant"
      :id="applicant.id"
      :name="applicant.partner_name"
      :subtitle="applicant.job?.name || t('hrRecruitment.noJob')"
    >
      <template #badge>
        <SharedStatusBadge size="sm" :tone="hrApplicantBadge(applicant.status).tone" :label="t(hrApplicantBadge(applicant.status).labelKey)" data-testid="hr-recruitment-status" />
      </template>
    </SharedIdentityCard>

    <SharedRecordSection v-if="applicant" variant="panel" :title="t('hrRecruitment.detail.pipeline')">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('hrRecruitment.columns.stage')" for="hr-recruitment-record-stage">
          <USelect
            id="hr-recruitment-record-stage"
            class="w-full"
            :model-value="applicant.stage ? String(applicant.stage.id) : undefined"
            :items="stageOptions"
            :placeholder="t('hrRecruitment.noStage')"
            :disabled="!hydrated || !canManage || writing"
            data-testid="hr-recruitment-stage"
            @update:model-value="changeStage(String($event))"
          />
        </UFormField>
        <UFormField :label="t('hrRecruitment.columns.priority')" for="hr-recruitment-record-priority">
          <USelect
            id="hr-recruitment-record-priority"
            class="w-full"
            :model-value="applicant.priority"
            :items="priorityOptions"
            :disabled="!hydrated || !canManage || writing"
            data-testid="hr-recruitment-priority"
            @update:model-value="changePriority(String($event))"
          />
        </UFormField>
      </div>
    </SharedRecordSection>

    <SharedRecordSection v-if="applicant" variant="panel" :title="t('hrRecruitment.detail.contact')">
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrRecruitment.form.email')" :value="applicant.email_from || t('hrRecruitment.detail.empty')" />
        <SharedPropertyRow :label="t('hrRecruitment.form.phone')" :value="applicant.partner_phone || t('hrRecruitment.detail.empty')" />
        <SharedPropertyRow :label="t('hrRecruitment.form.availability')" :value="applicant.availability ? formatDate(applicant.availability) : t('hrRecruitment.detail.empty')" />
        <SharedPropertyRow :label="t('hrRecruitment.detail.appliedOn')">
          <time :datetime="applicant.applied_on">{{ formatDateTime(applicant.applied_on) }}</time>
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </SharedRecordSection>

    <template v-if="applicant" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrRecruitment.columns.job')" :value="applicant.job?.name || t('hrRecruitment.noJob')" />
        <SharedPropertyRow :label="t('hrRecruitment.detail.department')" :value="applicant.department?.name || t('hrRecruitment.noDepartment')" />
        <SharedPropertyRow :label="t('hrRecruitment.detail.employee')">
          <NuxtLink v-if="applicant.employee" :to="`/hr/employees/${applicant.employee.id}`" class="text-primary hover:underline" data-testid="hr-recruitment-employee-link">{{ applicant.employee.name }}</NuxtLink>
          <template v-else>{{ t('hrRecruitment.detail.noEmployee') }}</template>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('hrRecruitment.detail.refuseReason')" :value="applicant.refuse_reason?.name || t('hrRecruitment.detail.noRefuseReason')" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
