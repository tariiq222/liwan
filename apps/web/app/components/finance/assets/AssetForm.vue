<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { localIsoDay } from '@webvue/ui/app/utils/formatDate'
import { useCreateFinanceAsset, useFinanceAssetProfiles, useUpdateFinanceAsset } from '@/composables/finance/useFinanceAssets'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import { financeErrorMessage } from '../financeErrors'
import { assetErrorKey } from './assetErrors'
import { assetDraftDirty, buildAssetCreate, buildAssetUpdate, emptyAssetDraft, hasAssetErrors, validateAssetDraft, type AssetFormDraft } from './assetDraft'
import { assetMethodSummary } from './assetMethod'

// The editor of an asset: the create panel (a new draft on a profile, whose depreciation method it takes) and the record
// page's edit mode (a draft's fields, the profile included). The board is computed when the asset is run; the server has
// the last word on the amounts and the period lock.
const props = defineProps<{
  backTo: RouteLocationRaw
  /** The draft being edited; omitted when a new asset is created. */
  recordId?: number
  initial?: AssetFormDraft
}>()
const emit = defineEmits<{ saved: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateFinanceAsset()
const update = useUpdateFinanceAsset()
const profiles = useFinanceAssetProfiles()

const baseline = props.initial ?? emptyAssetDraft(localIsoDay())
const draft = reactive<AssetFormDraft>(structuredClone(toRaw(baseline)))
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const dirty = computed(() => !saved.value && assetDraftDirty(draft, baseline))
const errors = computed(() => validateAssetDraft(draft))
const shown = computed(() => attempted.value ? errors.value : {})
const profileItems = computed(() => (profiles.data.value?.items ?? []).map(profile => ({ value: profile.id, label: profile.name })))
const profile = computed(() => profiles.data.value?.items.find(item => item.id === draft.profileId))
const pending = computed(() => create.isPending.value || update.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (hasAssetErrors(errors.value)) return
  // A change that only differs in formatting (12000.00, a typed 0 salvage, trailing spaces) builds an empty body: unchanged.
  const body = props.recordId ? buildAssetUpdate(draft, baseline) : null
  if (props.recordId && body && Object.keys(body).length === 0) {
    emit('saved', props.recordId)
    return
  }
  try {
    const record = props.recordId
      ? await update.mutateAsync({ id: props.recordId, body: body! })
      : await create.mutateAsync(buildAssetCreate(draft))
    saved.value = true
    await nextTick()
    emit('saved', record.id)
  } catch (cause) {
    error.value = financeErrorMessage(cause, assetErrorKey, t)
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-asset-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-asset-form-error" />
    <SharedFormSection panel :title="t('financeAssets.form.details')">
      <div class="grid gap-4">
        <UFormField :label="t('financeAssets.form.profile')" name="finance-asset-profile" required :help="profile ? assetMethodSummary(profile, t) : undefined" :error="shown.profile ? t('financeAssets.form.profileRequired') : undefined">
          <USelect id="finance-asset-profile" :model-value="draft.profileId ?? undefined" class="w-full" :items="profileItems" :loading="profiles.isPending.value" :placeholder="t('financeAssets.form.profilePlaceholder')" :color="shown.profile ? 'error' : undefined" :disabled="!hydrated || pending" @update:model-value="draft.profileId = $event" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeAssets.form.name')" name="finance-asset-name" required :error="shown.name ? t('financeAssets.form.nameRequired') : undefined">
            <UInput id="finance-asset-name" v-model="draft.name" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField :label="t('financeAssets.form.code')" name="finance-asset-code" :error="shown.code ? t('financeAssets.form.codeTooLong') : undefined">
            <UInput id="finance-asset-code" v-model="draft.code" class="w-full" dir="ltr" maxlength="32" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <UFormField :label="t('financeAssets.form.dateStart')" name="finance-asset-date-start" required :error="shown.dateStart ? t('financeAssets.form.dateRequired') : undefined">
          <SharedDateField id="finance-asset-date-start" v-model="draft.dateStart" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('financeAssets.form.partner')" name="finance-asset-partner">
          <PartnerPicker id="finance-asset-partner" v-model="draft.partnerId" kind="vendor" :disabled="pending" :placeholder="t('financeAssets.form.partnerPlaceholder')" />
        </UFormField>
        <UFormField :label="t('financeAssets.form.note')" name="finance-asset-note">
          <UTextarea id="finance-asset-note" v-model="draft.note" class="w-full" maxlength="255" :rows="3" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeAssets.form.values')">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('financeAssets.form.purchaseValue')" name="finance-asset-purchase" required :error="shown.purchaseValue ? t('financeAssets.form.purchaseInvalid') : undefined">
          <UInput id="finance-asset-purchase" v-model="draft.purchaseValue" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('financeAssets.form.salvageValue')" name="finance-asset-salvage" :error="shown.salvageValue ? t('financeAssets.form.salvageInvalid') : undefined">
          <UInput id="finance-asset-salvage" v-model="draft.salvageValue" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeAssets.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton v-if="recordId" type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" data-testid="finance-asset-cancel" @click="emit('cancel')" />
        <UButton v-else type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="recordId ? t('financeAssets.form.save') : t('financeAssets.form.create')" data-testid="finance-asset-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
