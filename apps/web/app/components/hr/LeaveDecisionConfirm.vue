<script setup lang="ts">
import type { HrLeave } from '@webvue/contracts'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'

export type LeaveConfirmKind = 'refuse' | 'cancel' | 'withdraw' | 'requestCancellation' | 'approveCancellation' | 'refuseCancellation' | 'managerCancel'

// One inline confirmation for the three destructive leave actions. It always names the
// employee and the dates, and asks for an optional reason where the server keeps one.
const props = defineProps<{ leave: HrLeave; kind: LeaveConfirmKind; pending?: boolean }>()
const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>()
const { t } = useI18n()
const { period } = useHrLeaveFormat()
const reason = ref('')
const withReason = computed(() => props.kind !== 'withdraw')
const requiredReason = computed(() => props.kind === 'refuseCancellation')
const title = computed(() => t(`hr.leave.${props.kind}Confirm`, {
  type: props.leave.leave_type.name,
  employee: props.leave.employee.name,
  period: period(props.leave),
}))
</script>

<template>
  <SharedInlineConfirm
    :title="title"
    :confirm-label="t(`hr.leave.${props.kind}`)"
    :cancel-label="t('app.back')"
    :pending="props.pending"
    :disabled="requiredReason && !reason.trim()"
    :color="props.kind === 'approveCancellation' ? 'primary' : 'error'"
    @confirm="(!requiredReason || reason.trim()) && emit('confirm', reason.trim())"
    @cancel="emit('cancel')"
  >
    <UFormField v-if="withReason" :label="t(requiredReason ? 'hr.leave.reasonRequired' : 'hr.leave.reasonOptional')" for="hr-leave-confirm-reason">
      <UTextarea id="hr-leave-confirm-reason" v-model="reason" class="w-full" :rows="2" :disabled="props.pending" data-testid="hr-leave-confirm-reason" />
    </UFormField>
  </SharedInlineConfirm>
</template>
