<script setup lang="ts">
import type { FinanceAccount, FinanceJournal } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import AccountPicker from '../AccountPicker.vue'
import { useCreateSetupJournal, usePatchSetupJournal } from '@/composables/finance/useFinanceRecords'
import { journalCreate, journalDraft, journalPatch, journalValid, JOURNAL_TYPES, LIQUIDITY_JOURNAL_TYPES } from './recordForms'

// The inline form of the journals: a new journal, or the name, code and default account of an existing one. The type is chosen
// once: it decides the numbering, the payment methods and the accounts of the journal. A bank or cash journal names its account.
const props = defineProps<{ journal?: FinanceJournal }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const draft = reactive(journalDraft(props.journal))
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateSetupJournal()
const { mutateAsync: patch, isPending: patching } = usePatchSetupJournal()
const pending = computed(() => creating.value || patching.value)
const valid = computed(() => journalValid(draft))
const liquidity = computed(() => LIQUIDITY_JOURNAL_TYPES.includes(draft.type))
const typeItems = computed(() => JOURNAL_TYPES.map(type => ({ value: type, label: t(`financeRecords.journals.types.${type}`) })))
const cashAccount = (account: FinanceAccount) => account.account_type === 'asset_cash'

async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.journal) {
      const changes = journalPatch(props.journal, draft)
      if (changes) await patch({ id: props.journal.id, patch: changes })
    } else {
      await create(journalCreate(draft))
    }
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="draft" class="webvue-form" method="post" :loading-auto="false" novalidate data-testid="finance-record-journal-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeRecords.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeRecords.journals.form.name')" name="finance-record-journal-name" required>
        <UInput id="finance-record-journal-name" v-model="draft.name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeRecords.journals.form.code')" name="finance-record-journal-code" required>
        <UInput id="finance-record-journal-code" v-model="draft.code" dir="ltr" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField v-if="!journal" :label="t('financeRecords.journals.form.type')" name="finance-record-journal-type" required>
        <USelect id="finance-record-journal-type" v-model="draft.type" class="w-full" :items="typeItems" :disabled="!hydrated" />
      </UFormField>
      <UFormField v-if="!journal" :label="t('financeRecords.journals.form.currency')" name="finance-record-journal-currency" :help="t('financeRecords.journals.form.currencyHelp')">
        <UInput id="finance-record-journal-currency" v-model="draft.currency" dir="ltr" class="w-full" maxlength="8" :disabled="!hydrated" />
      </UFormField>
      <UFormField v-if="liquidity" :label="t('financeRecords.journals.form.defaultAccount')" name="finance-record-journal-account" :help="t('financeRecords.journals.form.defaultAccountHelp')" required>
        <AccountPicker id="finance-record-journal-account" v-model="draft.defaultAccountId" :allow="cashAccount" :aria-label="t('financeRecords.journals.form.defaultAccount')" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-record-journal-save" />
    </div>
  </UForm>
</template>
