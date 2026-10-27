<script setup lang="ts">
import type { HrPlanRunDetail } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'

// Cancelling a plan run launched by mistake (wrong employee or plan): an inline confirmation
// with a required reason. The server removes the open steps and keeps the done ones; once
// cancelled, the run shows who cancelled it, when and why.
const props = withDefaults(defineProps<{
  run: HrPlanRunDetail
  namespace: string
  pending?: boolean
}>(), { pending: false })
const emit = defineEmits<{ confirm: [reason: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const confirming = ref(false)
const reason = ref('')

function open() {
  reason.value = ''
  confirming.value = true
}
function submitReason() {
  if (props.pending || !reason.value.trim()) return
  emit('confirm', reason.value.trim())
}
watch(() => props.run.state, (state) => {
  if (state === 'cancelled') confirming.value = false
})
</script>

<template>
  <UAlert
    v-if="props.run.cancellation"
    color="neutral"
    variant="subtle"
    icon="i-lucide-ban"
    :title="t(`${props.namespace}.cancel.cancelledBy`, { name: props.run.cancellation.by.name, on: formatDateTime(props.run.cancellation.on) })"
    :description="props.run.cancellation.reason"
    data-testid="hr-run-cancellation"
  />
  <template v-else-if="props.run.can_cancel">
    <SharedInlineConfirm
      v-if="confirming"
      :title="t(`${props.namespace}.cancel.confirm`, { employee: props.run.employee.name, plan: props.run.plan.name })"
      :confirm-label="t(`${props.namespace}.cancel.action`)"
      :cancel-label="t('app.back')"
      :pending="props.pending"
      :disabled="!hydrated || !reason.trim()"
      color="error"
      @confirm="submitReason"
      @cancel="confirming = false"
    >
      <UFormField :label="t(`${props.namespace}.cancel.reason`)" :help="t(`${props.namespace}.cancel.hint`)" for="hr-run-cancel-reason" required>
        <UTextarea id="hr-run-cancel-reason" v-model="reason" class="w-full" :rows="2" :disabled="props.pending" data-testid="hr-run-cancel-reason" />
      </UFormField>
    </SharedInlineConfirm>
    <div v-else class="flex justify-end">
      <UButton
        color="error"
        variant="outline"
        icon="i-lucide-ban"
        :disabled="!hydrated"
        :label="t(`${props.namespace}.cancel.action`)"
        data-testid="hr-run-cancel"
        @click="open"
      />
    </div>
  </template>
</template>
