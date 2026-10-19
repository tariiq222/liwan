<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'
import { useHrLeaveRequest, useLeaveDecision, type HrLeaveDecision } from '@/composables/useHrLeave'
import { hrLeaveBadge } from '@/utils/hrLeaveBadge'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { period, days } = useHrLeaveFormat()

const id = computed(() => Number(route.params.leaveId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrLeaveRequest(computed(() => validId.value ? id.value : null))
const leave = computed(() => query.data.value)
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const sourcePaths = useRecordListPaths(['/hr/leave'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const decision = useLeaveDecision()
const decisionError = ref('')
const canApprove = computed(() => !!leave.value?.can_approve && can('hr.leave.approve'))
const canRefuse = computed(() => !!leave.value?.can_refuse && can('hr.leave.approve'))

async function decide(kind: HrLeaveDecision) {
  if (!leave.value || !hydrated.value || decision.isPending.value) return
  decisionError.value = ''
  try {
    await decision.mutateAsync({ id: leave.value.id, decision: kind })
  } catch (cause) {
    decisionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!leave"
    :title="leave?.leave_type.name || t('hr.leave.record')"
    :description="leave?.employee.name"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="leave && (canApprove || canRefuse)" #actions>
      <UButton v-if="canApprove" color="primary" icon="i-lucide-check" :loading="decision.isPending.value" :disabled="!hydrated" :label="t('hr.leave.approve')" data-testid="hr-leave-record-approve" @click="decide('approve')" />
      <UButton v-if="canRefuse" color="neutral" variant="outline" icon="i-lucide-x" :disabled="!hydrated || decision.isPending.value" :label="t('hr.leave.refuse')" data-testid="hr-leave-record-refuse" @click="decide('refuse')" />
    </template>
    <UAlert v-if="decisionError" role="alert" color="error" variant="subtle" :title="decisionError" data-testid="hr-leave-decision-error" />
    <template v-if="leave">
      <SharedIdentityCard :id="leave.id" :name="leave.leave_type.name" :subtitle="leave.employee.name">
        <template #badge>
          <SharedStatusBadge size="sm" :tone="hrLeaveBadge(leave.state).tone" :label="t(hrLeaveBadge(leave.state).labelKey)" data-testid="hr-leave-state" />
        </template>
      </SharedIdentityCard>
      <SharedRecordSection v-if="leave.notes" :title="t('hr.leave.form.notes')">
        <p class="whitespace-pre-line text-sm">{{ leave.notes }}</p>
      </SharedRecordSection>
    </template>
    <template v-if="leave" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hr.leave.columns.employee')" :value="leave.employee.name" />
        <SharedPropertyRow :label="t('hr.leave.columns.type')" :value="leave.leave_type.name" />
        <SharedPropertyRow :label="t('hr.leave.columns.period')"><bdi>{{ period(leave) }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('hr.leave.columns.days')" :value="days(leave.number_of_days)" />
        <SharedPropertyRow :label="t('hr.leave.columns.state')" :value="t(hrLeaveBadge(leave.state).labelKey)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
