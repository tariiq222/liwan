<script setup lang="ts">
import type { FinanceZatcaJournal } from '@webvue/contracts'
import { useOnboardZatcaJournal } from '@/composables/finance/useFinanceZatca'
import { isOtpValid, OTP_LENGTH, otpDigits, zatcaErrorMessage } from './zatcaOnboarding'

// The inline onboarding of one sales journal: the six-digit one-time password of the Fatoora portal, then an inline confirmation.
const props = defineProps<{ journal: FinanceZatcaJournal['journal'] }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const fieldId = `finance-zatca-otp-${props.journal.id}`

const otp = ref('')
const confirming = ref(false)
const failure = ref<unknown>(null)
const { mutateAsync: onboard, isPending } = useOnboardZatcaJournal()
const valid = computed(() => isOtpValid(otp.value))

function review() {
  if (hydrated.value && valid.value) confirming.value = true
}
async function submitOnboarding() {
  if (!hydrated.value || isPending.value || !can('finance.zatca.manage') || !valid.value) return
  try {
    await onboard({ journalId: props.journal.id, otp: otp.value })
    otp.value = ''
    emit('done')
  } catch (cause) {
    failure.value = cause
    confirming.value = false
  }
}
</script>

<template>
  <form class="grid gap-3 pb-3" :data-testid="`finance-zatca-form-${journal.id}`" @submit.prevent="review">
    <UFormField :label="t('financeGovernance.zatca.otp.label')" :help="t('financeGovernance.zatca.otp.help')" :name="fieldId">
      <UInput :id="fieldId" :model-value="otp" class="w-full md:w-56" dir="ltr" inputmode="numeric" autocomplete="off" :maxlength="OTP_LENGTH" :placeholder="'0'.repeat(OTP_LENGTH)" :disabled="!hydrated || isPending || confirming" @update:model-value="otp = otpDigits(String($event))" />
    </UFormField>
    <UAlert v-if="failure" color="error" variant="subtle" :title="zatcaErrorMessage(failure, t)" data-testid="finance-zatca-error" />
    <SharedInlineConfirm
      v-if="confirming"
      color="warning"
      :title="t('financeGovernance.zatca.onboard.confirmTitle', { journal: journal.name })"
      :description="t('financeGovernance.zatca.onboard.confirmDescription')"
      :confirm-label="t('financeGovernance.zatca.onboard.confirm')"
      :pending="isPending"
      :disabled="!hydrated"
      @confirm="submitOnboarding"
      @cancel="confirming = false"
    />
    <div v-else class="flex flex-wrap items-center gap-2">
      <UButton type="submit" color="primary" icon="i-lucide-check" :disabled="!hydrated || !valid" :label="t('financeGovernance.zatca.onboard.review')" />
      <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated" :label="t('financeGovernance.zatca.onboard.cancel')" @click="emit('cancel')" />
    </div>
  </form>
</template>
