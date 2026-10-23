<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'
import { useHrLeaveRequest, useMyHrLeaveRequest, useLeaveDecision, useCancellationDecision, useWithdrawLeaveRequest, type HrLeaveDecision } from '@/composables/useHrLeave'
import type { LeaveConfirmKind } from '@/components/hr/LeaveDecisionConfirm.vue'
import { hrLeaveBadge } from '@/utils/hrLeaveBadge'
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'

const props = defineProps<{ personal?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { period, days } = useHrLeaveFormat()

const id = computed(() => Number(route.params.leaveId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const ownId = computed(() => props.personal && validId.value ? id.value : null)
const managementId = computed(() => !props.personal && validId.value ? id.value : null)
const ownQuery = useMyHrLeaveRequest(ownId)
const managementQuery = useHrLeaveRequest(managementId)
const query = computed(() => props.personal ? ownQuery : managementQuery)
const leave = computed(() => query.value.data.value)
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.value.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const sourcePaths = computed(() => props.personal ? ['/account/leave'] : ['/hr/leave'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const headerTags = computed(() => leave.value
  ? [statusTag({ tone: hrLeaveBadge(leave.value.state).tone, label: t(hrLeaveBadge(leave.value.state).labelKey) }, 'hr-leave-state')]
  : [])

const decision = useLeaveDecision()
const cancellationDecision = useCancellationDecision()
const withdrawal = useWithdrawLeaveRequest()
const decisionError = ref('')
// Refuse, cancel and withdraw each ask inline first; only one confirmation is open at a time.
const confirming = ref<LeaveConfirmKind | null>(null)
const confirmationRevision = ref<number | null>(null)
function beginConfirm(kind: LeaveConfirmKind) {
  confirming.value = kind
  confirmationRevision.value = leave.value?.cancellation?.revision ?? null
}
watch(id, () => { confirming.value = null; confirmationRevision.value = null; decisionError.value = '' })
const writing = computed(() => decision.isPending.value || withdrawal.isPending.value || cancellationDecision.isPending.value)
const canApprove = computed(() => !props.personal && !!leave.value?.can_approve && can('hr.leave.approve'))
const canRefuse = computed(() => !props.personal && !!leave.value?.can_refuse && can('hr.leave.approve'))
const canCancel = computed(() => !!leave.value?.can_cancel)
const canRequestCancellation = computed(() => !!leave.value?.can_request_cancellation)
const canApproveCancellation = computed(() => !props.personal && !!leave.value?.can_approve_cancellation && can('hr.leave.approve'))
const canRefuseCancellation = computed(() => !props.personal && !!leave.value?.can_refuse_cancellation && can('hr.leave.approve'))
const cancelKind = computed(() => props.personal ? 'cancel' : 'managerCancel')

async function decide(kind: HrLeaveDecision, reason?: string) {
  if (!leave.value || !hydrated.value || writing.value) return
  decisionError.value = ''
  try {
    await decision.mutateAsync({ id: leave.value.id, decision: kind, reason })
    confirming.value = null
  } catch (cause) {
    decisionError.value = cause instanceof ApiError && cause.status === 409 ? t('hr.leave.cancellationConflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
    if (cause instanceof ApiError && cause.status === 409) await query.value.refetch()
  }
}

async function onConfirm(reason: string) {
  if (confirming.value === 'withdraw') return withdraw()
  if (confirming.value === 'approveCancellation' || confirming.value === 'refuseCancellation') {
    if (!leave.value?.cancellation || !confirmationRevision.value || !hydrated.value || writing.value || (confirming.value === 'refuseCancellation' && !reason.trim())) return
    decisionError.value = ''
    try {
      await cancellationDecision.mutateAsync({ id: leave.value.id, revision: confirmationRevision.value, decision: confirming.value === 'approveCancellation' ? 'approve' : 'refuse', reason })
      confirming.value = null
    } catch (cause) {
      decisionError.value = cause instanceof ApiError && cause.status === 409 ? t('hr.leave.cancellationConflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
      if (cause instanceof ApiError && cause.status === 409) { confirming.value = null; await query.value.refetch() }
    }
    return
  }
  if (confirming.value) return decide(confirming.value === 'requestCancellation' || confirming.value === 'managerCancel' ? 'cancel' : confirming.value, reason)
}

/** A withdrawn request is deleted, so the record is left for the list it came from. */
async function withdraw() {
  if (!leave.value || !hydrated.value || writing.value) return
  decisionError.value = ''
  try {
    await withdrawal.mutateAsync(leave.value.id)
    await navigateTo(backTo.value, { replace: true })
  } catch (cause) {
    decisionError.value = cause instanceof ApiError && cause.status === 409 ? t('hr.leave.cancellationConflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
    if (cause instanceof ApiError && cause.status === 409) await query.value.refetch()
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!leave"
    :title="leave?.leave_type.name || t('hr.leave.record')"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="leave && (canApprove || canRefuse || leave.can_withdraw || canCancel || canRequestCancellation || canApproveCancellation || canRefuseCancellation)" #actions>
      <UButton v-if="canApprove" color="primary" icon="i-lucide-check" :loading="decision.isPending.value" :disabled="!hydrated || writing" :label="t('hr.leave.approve')" data-testid="hr-leave-record-approve" @click="decide('approve')" />
      <UButton v-if="canRefuse" color="neutral" variant="outline" icon="i-lucide-x" :disabled="!hydrated || decision.isPending.value" :label="t('hr.leave.refuse')" data-testid="hr-leave-record-refuse" @click="beginConfirm('refuse')" />
      <UButton v-if="leave.can_withdraw" color="error" variant="outline" icon="i-lucide-undo-2" :disabled="!hydrated || writing" :label="t('hr.leave.withdraw')" data-testid="hr-leave-record-withdraw" @click="beginConfirm('withdraw')" />
      <UButton v-if="canCancel" color="error" variant="outline" icon="i-lucide-ban" :disabled="!hydrated || writing" :label="t(`hr.leave.${cancelKind}`)" data-testid="hr-leave-record-cancel" @click="beginConfirm(cancelKind)" />
      <UButton v-if="canRequestCancellation" color="neutral" variant="outline" icon="i-lucide-calendar-x" :disabled="!hydrated || writing" :label="t('hr.leave.requestCancellation')" data-testid="hr-leave-record-request-cancellation" @click="beginConfirm('requestCancellation')" />
      <UButton v-if="canApproveCancellation" color="primary" :disabled="!hydrated || writing" :label="t('hr.leave.approveCancellation')" data-testid="hr-leave-record-approve-cancellation" @click="beginConfirm('approveCancellation')" />
      <UButton v-if="canRefuseCancellation" color="neutral" variant="outline" :disabled="!hydrated || writing" :label="t('hr.leave.refuseCancellation')" data-testid="hr-leave-record-refuse-cancellation" @click="beginConfirm('refuseCancellation')" />
    </template>
    <UAlert v-if="decisionError" role="alert" color="error" variant="subtle" :title="decisionError" data-testid="hr-leave-decision-error" />
    <HrLeaveDecisionConfirm
      v-if="leave && confirming"
      :kind="confirming"
      :leave="leave"
      :pending="writing"
      @confirm="onConfirm($event)"
      @cancel="confirming = null"
    />
    <template v-if="leave">
      <SharedRecordSection v-if="leave.cancellation" :title="t('hr.leave.cancellationTitle')">
        <SharedStatusBadge :tone="leave.cancellation.state === 'refused' ? 'error' : leave.cancellation.state === 'pending' ? 'warning' : 'success'" :label="t(`hr.leave.cancellationStates.${leave.cancellation.state}`)" />
        <p class="mt-2 text-sm">{{ t('hr.leave.cancellationInitiator', { name: leave.cancellation.initiator.name }) }}</p>
        <p v-if="leave.cancellation.reason" class="whitespace-pre-line text-sm">{{ leave.cancellation.reason }}</p>
        <p v-if="leave.cancellation.reviewer" class="mt-2 text-sm">{{ t('hr.leave.cancellationReviewer', { name: leave.cancellation.reviewer.name }) }}</p>
        <p v-if="leave.cancellation.review_reason" class="whitespace-pre-line text-sm">{{ leave.cancellation.review_reason }}</p>
      </SharedRecordSection>
      <SharedIdentityCard :id="leave.id" :name="leave.leave_type.name" :subtitle="leave.employee.name" />
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
