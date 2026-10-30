<script setup lang="ts">
import type { HrPayrollRun } from '@liwan/contracts'

// The transitions of one payroll run. Compute is a plain action; approving (it locks the payslips), cancelling (it
// deletes the run) and posting (it creates the accounting entry, whose preview the page fills in the `post-preview`
// slot) ask for an inline confirmation first, as does the end-of-service provision (a second accounting entry for the run's month, offered by the finance bridge); recording the payment opens the page's `payment-form` slot, which is its
// own confirmation. Every action stays pending until the server answers, and the buttons offered are exactly the
// run's `allowed_actions` (post and record_payment exist only with the finance bridge). Not printed.
type Action = 'compute' | 'approve' | 'cancel' | 'post' | 'record_payment' | 'eos_provision'
type Asking = 'approve' | 'cancel' | 'post' | 'record_payment' | 'eos_provision'
const ACTIONS: Action[] = ['compute', 'approve', 'post', 'record_payment', 'eos_provision', 'cancel']
const props = defineProps<{
  run: HrPayrollRun
  /** The action in flight, or null. */
  pending: Action | null
  /** False while the posting preview is not shown yet (loading or refused): posting then waits. */
  postReady?: boolean
}>()
const emit = defineEmits<{ compute: []; approve: []; cancel: []; post: []; eosProvision: [] }>()
/** The action the user is being asked to confirm; the page reads it to load the posting preview only when it is shown. */
const confirming = defineModel<Asking | null>('confirming', { default: null })

const { t } = useI18n()
const hydrated = useHydrated()

const allowed = (action: Action) => props.run.allowed_actions.includes(action)
const busy = computed(() => !hydrated.value || props.pending !== null)
const visible = computed(() => ACTIONS.some(allowed))

// The answer of the server closes the confirmation of approve and cancel, whatever it is: a refusal is shown by the page
// above. Post and payment stay open after a refusal so they can be retried, and close themselves once the run moves on
// (their button is no longer in `allowed_actions`).
watch(() => props.pending, (now, was) => { if (was && !now && was !== 'post' && was !== 'record_payment') confirming.value = null })
</script>

<template>
  <div v-if="visible" class="liwan-print-hide grid gap-3" data-testid="hr-payroll-run-actions">
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
        v-if="allowed('post')"
        color="primary"
        icon="i-lucide-book-check"
        :disabled="busy"
        :label="t('hrPayroll.actions.post')"
        data-testid="hr-payroll-post"
        @click="confirming = 'post'"
      />
      <UButton
        v-if="allowed('record_payment')"
        color="primary"
        icon="i-lucide-banknote"
        :disabled="busy"
        :label="t('hrPayroll.actions.recordPayment')"
        data-testid="hr-payroll-record-payment"
        @click="confirming = 'record_payment'"
      />
      <UButton
        v-if="allowed('eos_provision')"
        color="primary"
        variant="outline"
        icon="i-lucide-piggy-bank"
        :disabled="busy"
        :label="t('hrPayroll.actions.eosProvision')"
        data-testid="hr-payroll-eos-provision"
        @click="confirming = 'eos_provision'"
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
    <div v-if="confirming === 'post' && allowed('post')" class="grid gap-3">
      <slot name="post-preview" />
      <SharedInlineConfirm
        color="primary"
        :title="t('hrPayroll.actions.postTitle')"
        :description="t('hrPayroll.actions.postHint')"
        :confirm-label="t('hrPayroll.actions.post')"
        :disabled="props.postReady === false"
        :pending="props.pending === 'post'"
        @confirm="emit('post')"
        @cancel="confirming = null"
      />
    </div>
    <slot v-if="confirming === 'record_payment' && allowed('record_payment')" name="payment-form" :close="() => { confirming = null }" />
    <SharedInlineConfirm
      v-if="confirming === 'eos_provision' && allowed('eos_provision')"
      color="primary"
      :title="t('hrPayroll.actions.eosProvisionTitle')"
      :description="t('hrPayroll.actions.eosProvisionHint')"
      :confirm-label="t('hrPayroll.actions.eosProvision')"
      :pending="props.pending === 'eos_provision'"
      @confirm="emit('eosProvision')"
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
