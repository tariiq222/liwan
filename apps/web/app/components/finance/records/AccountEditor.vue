<script setup lang="ts">
import type { FinanceAccount } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useCreateSetupAccount, usePatchSetupAccount } from '@/composables/finance/useFinanceRecords'
import { ACCOUNT_TYPES } from '../accounting/accountListParams'
import { accountCreate, accountDraft, accountPatch, accountValid } from './recordForms'

// The inline form of the chart of accounts: a new account, or the code, name, type, reconciliation and currency of an existing
// one. An account that has journal items keeps its type; the server refuses the change and says why.
const props = defineProps<{ account?: FinanceAccount }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const draft = reactive(accountDraft(props.account))
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateSetupAccount()
const { mutateAsync: patch, isPending: patching } = usePatchSetupAccount()
const pending = computed(() => creating.value || patching.value)
const valid = computed(() => accountValid(draft))
const typeItems = computed(() => ACCOUNT_TYPES.map(type => ({ value: type, label: t(`financeAccounting.accountTypes.${type}`) })))

async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.account) {
      const changes = accountPatch(props.account, draft)
      if (changes) await patch({ id: props.account.id, patch: changes })
    } else {
      await create(accountCreate(draft))
    }
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="draft" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="finance-record-account-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeRecords.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <div class="liwan-form-grid">
      <UFormField :label="t('financeRecords.accounts.form.code')" name="finance-record-account-code" required>
        <UInput id="finance-record-account-code" v-model="draft.code" dir="ltr" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeRecords.accounts.form.name')" name="finance-record-account-name" required>
        <UInput id="finance-record-account-name" v-model="draft.name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeRecords.accounts.form.type')" name="finance-record-account-type" required>
        <USelect id="finance-record-account-type" v-model="draft.accountType" class="w-full" :items="typeItems" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t('financeRecords.accounts.form.currency')" name="finance-record-account-currency" :help="t('financeRecords.accounts.form.currencyHelp')">
        <UInput id="finance-record-account-currency" v-model="draft.currency" dir="ltr" class="w-full" maxlength="8" :disabled="!hydrated" />
      </UFormField>
      <USwitch v-model="draft.reconcile" :label="t('financeRecords.accounts.form.reconcile')" :disabled="!hydrated" />
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-record-account-save" />
    </div>
  </UForm>
</template>
