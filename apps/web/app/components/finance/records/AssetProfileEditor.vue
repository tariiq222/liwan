<script setup lang="ts">
import type { FinanceAssetProfile } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import AccountPicker from '../AccountPicker.vue'
import { useCreateSetupAssetProfile, usePatchSetupAssetProfile, useSetupJournals } from '@/composables/finance/useFinanceRecords'
import { assetProfileCreate, assetProfileDraft, assetProfilePatch, assetProfileValid } from './recordForms'

// The inline form of an asset profile: the depreciation method and the accounts and journal its entries are booked in. Once an
// asset uses the profile its accounts, journal and method are fixed (the server says so); the name and the disposal accounts can change.
const props = defineProps<{ profile?: FinanceAssetProfile }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const draft = reactive(assetProfileDraft(props.profile))
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateSetupAssetProfile()
const { mutateAsync: patch, isPending: patching } = usePatchSetupAssetProfile()
const pending = computed(() => creating.value || patching.value)
const valid = computed(() => assetProfileValid(draft))
const journals = useSetupJournals({ archived: 'false', type: 'general', limit: 100, offset: 0 })
const journalItems = computed(() => (journals.data.value?.items ?? []).map(journal => ({ value: journal.id, label: `${journal.code} ${journal.name}` })))
const methodItems = (['linear', 'degressive'] as const).map(value => ({ value, label: t(`financeRecords.assetProfiles.methods.${value}`) }))
const timeItems = (['year', 'number'] as const).map(value => ({ value, label: t(`financeRecords.assetProfiles.times.${value}`) }))
const periodItems = (['month', 'quarter', 'year'] as const).map(value => ({ value, label: t(`financeRecords.assetProfiles.periods.${value}`) }))

async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.profile) {
      const changes = assetProfilePatch(props.profile, draft)
      if (changes) await patch({ id: props.profile.id, patch: changes })
    } else {
      await create(assetProfileCreate(draft))
    }
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="draft" class="webvue-form" method="post" :loading-auto="false" novalidate data-testid="finance-record-asset-profile-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeRecords.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeRecords.assetProfiles.form.name')" name="finance-record-asset-profile-name" required class="sm:col-span-2">
        <UInput id="finance-record-asset-profile-name" v-model="draft.name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.method')" name="finance-record-asset-profile-method" required>
        <USelect id="finance-record-asset-profile-method" v-model="draft.method" class="w-full" :items="methodItems" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.methodTime')" name="finance-record-asset-profile-time" required>
        <USelect id="finance-record-asset-profile-time" v-model="draft.methodTime" class="w-full" :items="timeItems" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t(draft.methodTime === 'year' ? 'financeRecords.assetProfiles.form.years' : 'financeRecords.assetProfiles.form.periods')" name="finance-record-asset-profile-number" required>
        <UInput id="finance-record-asset-profile-number" v-model.number="draft.methodNumber" type="number" min="1" max="1200" step="1" class="w-full tabular-nums" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.methodPeriod')" name="finance-record-asset-profile-period" required>
        <USelect id="finance-record-asset-profile-period" v-model="draft.methodPeriod" class="w-full" :items="periodItems" :disabled="!hydrated" />
      </UFormField>
      <UFormField name="finance-record-asset-profile-prorata" class="sm:col-span-2">
        <UCheckbox v-model="draft.prorata" :label="t('financeRecords.assetProfiles.form.prorata')" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.assetAccount')" name="finance-record-asset-profile-asset" required>
        <AccountPicker id="finance-record-asset-profile-asset" v-model="draft.assetAccountId" :aria-label="t('financeRecords.assetProfiles.form.assetAccount')" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.depreciationAccount')" name="finance-record-asset-profile-depreciation" required>
        <AccountPicker id="finance-record-asset-profile-depreciation" v-model="draft.depreciationAccountId" :aria-label="t('financeRecords.assetProfiles.form.depreciationAccount')" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.expenseAccount')" name="finance-record-asset-profile-expense" required>
        <AccountPicker id="finance-record-asset-profile-expense" v-model="draft.expenseAccountId" :aria-label="t('financeRecords.assetProfiles.form.expenseAccount')" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.journal')" name="finance-record-asset-profile-journal" required>
        <USelect id="finance-record-asset-profile-journal" :model-value="draft.journalId ?? undefined" class="w-full" :items="journalItems" :disabled="!hydrated" @update:model-value="value => { draft.journalId = Number(value) }" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.plusAccount')" name="finance-record-asset-profile-plus" :help="t('financeRecords.assetProfiles.form.disposalHelp')">
        <AccountPicker id="finance-record-asset-profile-plus" v-model="draft.plusAccountId" :aria-label="t('financeRecords.assetProfiles.form.plusAccount')" />
      </UFormField>
      <UFormField :label="t('financeRecords.assetProfiles.form.minAccount')" name="finance-record-asset-profile-min" :help="t('financeRecords.assetProfiles.form.disposalHelp')">
        <AccountPicker id="finance-record-asset-profile-min" v-model="draft.minAccountId" :aria-label="t('financeRecords.assetProfiles.form.minAccount')" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-record-asset-profile-save" />
    </div>
  </UForm>
</template>
