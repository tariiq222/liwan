<script setup lang="ts">
import type { HrPayrollRun } from '@webvue/contracts'

// The transitions of one payroll run. Compute is a plain action; approving (it locks the payslips) and cancelling (it
// deletes the run) ask for an inline confirmation first. Every action stays pending until the server answers, and the
// buttons offered are exactly the run's `allowed_actions`. Not printed.
type Action = 'compute' | 'approve' | 'cancel'
const props = defineProps<{
  run: HrPayrollRun
  /** The action in flight, or null. */
  pending: Action | null
}>()
const emit = defineEmits<{ compute: []; approve: []; cancel: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const confirming = ref<'approve' | 'cancel' | null>(null)
const allowed = (action: Action) => props.run.allowed_actions.includes(action)
const busy = computed(() => !hydrated.value || props.pending !== null)
const visible = computed(() => (['compute', 'approve', 'cancel'] as const).some(allowed))

// The answer of the server (either way) closes the confirmation: a refusal is shown by the page above.
watch(() => props.pending, (now, was) => { if (was && !now) confirming.value = null })
</script>

<template>
  <div v-if="visible" class="webvue-print-hide grid gap-3" data-testid="hr-payroll-run-actions">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="allowed('compute')"
        color="primary"
        variant="outline"
        icon="i-lucide-calculator"
        :disabled="busy"
        :loading="props.pending === 'compute'"
        :label="t(props.run.state === 'draft' ? 'hrPayroll.actions.compute' : 'hrPayroll.actions.recompute')"
        data-testid="hr-payroll-compute"
        @click="emit('compute')"
      />
      <UButton
        v-if="allowed('approve')"
        color="primary"
        icon="i-lucide-badge-check"
        :disabled="busy"
        :label="t('hrPayroll.actions.approve')"
        data-testid="hr-payroll-approve"
        @click="confirming = 'approve'"
      />
      <UButton
        v-if="allowed('cancel')"
        color="error"
        variant="outline"
        icon="i-lucide-trash-2"
        :disabled="busy"
        :label="t('hrPayroll.actions.cancel')"
        data-testid="hr-payroll-cancel"
        @click="confirming = 'cancel'"
      />
    </div>
    <SharedInlineConfirm
      v-if="confirming === 'approve' && allowed('approve')"
      color="primary"
      :title="t('hrPayroll.actions.approveTitle')"
      :description="t('hrPayroll.actions.approveHint')"
      :confirm-label="t('hrPayroll.actions.approve')"
      :pending="props.pending === 'approve'"
      @confirm="emit('approve')"
      @cancel="confirming = null"
    />
    <SharedInlineConfirm
      v-if="confirming === 'cancel' && allowed('cancel')"
      :title="t('hrPayroll.actions.cancelTitle')"
      :description="t('hrPayroll.actions.cancelHint')"
      :confirm-label="t('hrPayroll.actions.cancel')"
      :pending="props.pending === 'cancel'"
      @confirm="emit('cancel')"
      @cancel="confirming = null"
    />
  </div>
</template>
