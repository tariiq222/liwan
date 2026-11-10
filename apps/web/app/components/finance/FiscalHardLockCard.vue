<script setup lang="ts">
import type { FinanceSetup } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useFinanceSetupScope, useLockFinanceFiscal } from '@/composables/finance/useFinanceSetup'
import {
  financeFiscalSaveMessage,
  financeHardLockIssue,
  financeToday,
  isFinanceContextChanged,
  sameFinanceSetupScope,
  type FinanceSetupScope,
} from '@/composables/finance/financeFiscalSetup'

// The final close of the books up to a date. It cannot be undone, so it is its own action: pick a date, read what it means,
// tick the acknowledgement, then confirm inline. `scope` is the identity the setup was read for; the write states it as a
// precondition, like the fiscal save. A refusal keeps the choice on screen and says why.
const props = defineProps<{ setup: FinanceSetup; scope: FinanceSetupScope; canEdit: boolean }>()
const emit = defineEmits<{ contextChanged: []; saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: lockFiscal, isPending } = useLockFinanceFiscal()
const { read: readScope } = useFinanceSetupScope()

const current = computed(() => props.setup.fiscal.hard_lock_date)
const today = financeToday()
const chosen = ref<string | null>(null)
const confirming = ref(false)
const acknowledged = ref(false)
const failure = ref<string | null>(null)

const issue = computed(() => (chosen.value ? financeHardLockIssue(chosen.value, current.value, today) : null))
const dateError = computed(() => (issue.value ? t(`finance.setup.hardLock.errors.${issue.value}`) : undefined))
const canStart = computed(() => hydrated.value && props.canEdit && !!chosen.value && !issue.value && !confirming.value)

function start() {
  failure.value = null
  confirming.value = true
}

function cancel() {
  confirming.value = false
  acknowledged.value = false
}

async function lock() {
  if (!chosen.value || issue.value || !acknowledged.value) return
  failure.value = null
  try {
    await lockFiscal({ hard_lock_date: chosen.value, scope: props.scope })
  } catch (error) {
    // An answer for an identity the screen has left is another screen's outcome: it is not reported here.
    if (!sameFinanceSetupScope(props.scope, readScope())) return
    failure.value = financeFiscalSaveMessage(error, t)
    confirming.value = false
    acknowledged.value = false
    if (error instanceof ApiError && isFinanceContextChanged(error)) emit('contextChanged')
    return
  }
  if (!sameFinanceSetupScope(props.scope, readScope())) return
  chosen.value = null
  cancel()
  emit('saved')
  toast.add({ title: t('finance.setup.hardLock.done'), color: 'success' })
}
</script>

<template>
  <SharedRecordSection
    id="setup-hard-lock"
    variant="panel"
    :title="t('finance.setup.hardLock.title')"
    :description="t('finance.setup.hardLock.description')"
    data-testid="finance-setup-hard-lock"
  >
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t('finance.setup.fiscal.hard_lock_date')">
        <bdi v-if="current" dir="ltr" data-testid="finance-hard-lock-current">{{ current }}</bdi>
        <span v-else class="text-muted" data-testid="finance-hard-lock-current">{{ t('finance.setup.hardLock.none') }}</span>
      </SharedPropertyRow>
    </SharedPropertiesPanel>
    <template v-if="canEdit">
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :description="failure" data-testid="finance-hard-lock-error" />
      <UFormField
        orientation="horizontal"
        :label="t('finance.setup.hardLock.dateLabel')"
        :description="t('finance.setup.hardLock.dateHint')"
        name="finance-fiscal-hard_lock_date"
        :error="dateError"
      >
        <SharedDateField
          id="finance-fiscal-hard_lock_date"
          v-model="chosen"
          :min-value="current"
          :max-value="today"
          :disabled="!hydrated || confirming || isPending"
          :aria-label="t('finance.setup.hardLock.dateLabel')"
        />
      </UFormField>
      <SharedInlineConfirm
        v-if="confirming"
        :title="t('finance.setup.hardLock.confirmTitle')"
        :description="t('finance.setup.hardLock.confirmBody', { date: chosen })"
        :confirm-label="t('finance.setup.hardLock.confirm')"
        :disabled="!acknowledged"
        :pending="isPending"
        @cancel="cancel"
        @confirm="lock"
      >
        <UCheckbox v-model="acknowledged" class="mt-2" :label="t('finance.setup.hardLock.acknowledge')" data-testid="finance-hard-lock-acknowledge" />
      </SharedInlineConfirm>
      <div v-else class="flex justify-end">
        <UButton type="button" color="error" variant="outline" icon="i-lucide-lock" :disabled="!canStart" :label="t('finance.setup.hardLock.start')" data-testid="finance-hard-lock-start" @click="start" />
      </div>
    </template>
  </SharedRecordSection>
</template>
