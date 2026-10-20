<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'
import { useHrLeaveRequest, useLeaveDecision, useWithdrawLeaveRequest, type HrLeaveDecision } from '@/composables/useHrLeave'
import { hrLeaveBadge } from '@/utils/hrLeaveBadge'
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'

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

const headerTags = computed(() => leave.value
  ? [statusTag({ tone: hrLeaveBadge(leave.value.state).tone, label: t(hrLeaveBadge(leave.value.state).labelKey) }, 'hr-leave-state')]
  : [])

const decision = useLeaveDecision()
const withdrawal = useWithdrawLeaveRequest()
const decisionError = ref('')
// Refuse, cancel and withdraw each ask inline first; only one confirmation is open at a time.
const confirming = ref<'refuse' | 'cancel' | 'withdraw' | null>(null)
const writing = computed(() => decision.isPending.value || withdrawal.isPending.value)
const canApprove = computed(() => !!leave.value?.can_approve && can('hr.leave.approve'))
const canRefuse = computed(() => !!leave.value?.can_refuse && can('hr.leave.approve'))

async function decide(kind: HrLeaveDecision, reason?: string) {
  if (!leave.value || !hydrated.value || writing.value) return
  decisionError.value = ''
  try {
    await decision.mutateAsync({ id: leave.value.id, decision: kind, reason })
    confirming.value = null
  } catch (cause) {
    decisionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}

function onConfirm(reason: string) {
  if (confirming.value === 'withdraw') return withdraw()
  if (confirming.value) return decide(confirming.value, reason)
}

/** A withdrawn request is deleted, so the record is left for the list it came from. */
async function withdraw() {
  if (!leave.value || !hydrated.value || writing.value) return
  decisionError.value = ''
  try {
    await withdrawal.mutateAsync(leave.value.id)
    await navigateTo(backTo.value, { replace: true })
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
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="leave && (canApprove || canRefuse || leave.can_withdraw || leave.can_cancel)" #actions>
      <UButton v-if="canApprove" color="primary" icon="i-lucide-check" :loading="decision.isPending.value" :disabled="!hydrated || writing" :label="t('hr.leave.approve')" data-testid="hr-leave-record-approve" @click="decide('approve')" />
      <UButton v-if="canRefuse" color="neutral" variant="outline" icon="i-lucide-x" :disabled="!hydrated || decision.isPending.value" :label="t('hr.leave.refuse')" data-testid="hr-leave-record-refuse" @click="confirming = 'refuse'" />
      <UButton v-if="leave.can_withdraw" color="error" variant="outline" icon="i-lucide-undo-2" :disabled="!hydrated || writing" :label="t('hr.leave.withdraw')" data-testid="hr-leave-record-withdraw" @click="confirming = 'withdraw'" />
      <UButton v-if="leave.can_cancel" color="error" variant="outline" icon="i-lucide-ban" :disabled="!hydrated || writing" :label="t('hr.leave.cancel')" data-testid="hr-leave-record-cancel" @click="confirming = 'cancel'" />
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
