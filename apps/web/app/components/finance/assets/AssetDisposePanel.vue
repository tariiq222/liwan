<script setup lang="ts">
import type { FinanceAssetDetail } from '@webvue/contracts'
import { useDisposeFinanceAsset } from '@/composables/finance/useFinanceAssets'
import AccountPicker from '../AccountPicker.vue'
import { financeErrorMessage } from '../financeErrors'
import { assetErrorKey } from './assetErrors'
import { buildDispose, emptyDisposeDraft, isSale, validateDispose } from './assetDispose'

// Sells or scraps a running asset inline on its record: the depreciation is booked up to the date, the asset and its
// accumulated depreciation are cleared, and the proceeds and the gain or loss are posted. The gain and loss accounts default to
// the profile's; the server says when one is missing. It is permanent, so it asks for the figures first and posts once.
const props = defineProps<{ asset: FinanceAssetDetail }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const dispose = useDisposeFinanceAsset()
const draft = reactive(emptyDisposeDraft(new Date().toLocaleDateString('en-CA')))
const attempted = ref(false)
const error = ref('')
const errors = computed(() => validateDispose(draft))
const shown = computed(() => attempted.value ? errors.value : {})
const sale = computed(() => isSale(draft))

async function submit() {
  if (!hydrated.value || dispose.isPending.value) return
  attempted.value = true
  error.value = ''
  if (Object.keys(errors.value).length) return
  try {
    await dispose.mutateAsync({ id: props.asset.id, body: buildDispose(draft) })
    emit('done')
  } catch (cause) {
    error.value = financeErrorMessage(cause, assetErrorKey, t)
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="webvue-form rounded-card border border-default p-(--webvue-card-pad-dense)" method="post" data-testid="finance-asset-dispose-form" @submit="submit">
    <p class="font-semibold text-highlighted">{{ t('financeAssets.dispose.title', { name: asset.name }) }}</p>
    <p class="text-sm text-muted">{{ t('financeAssets.dispose.hint') }}</p>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-asset-dispose-error" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeAssets.dispose.date')" name="finance-asset-dispose-date" required :error="shown.date ? t('financeAssets.dispose.dateRequired') : undefined">
        <SharedDateField id="finance-asset-dispose-date" v-model="draft.date" :disabled="!hydrated || dispose.isPending.value" />
      </UFormField>
      <UFormField :label="t('financeAssets.dispose.saleValue')" name="finance-asset-dispose-sale" :help="t('financeAssets.dispose.saleHelp')" :error="shown.saleValue ? t('financeAssets.dispose.saleInvalid') : undefined">
        <UInput id="finance-asset-dispose-sale" v-model="draft.saleValue" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || dispose.isPending.value" />
      </UFormField>
      <UFormField v-if="sale" :label="t('financeAssets.dispose.saleAccount')" name="finance-asset-dispose-sale-account" required :help="t('financeAssets.dispose.saleAccountHelp')" :error="shown.saleAccountId ? t('financeAssets.dispose.saleAccountRequired') : undefined">
        <AccountPicker id="finance-asset-dispose-sale-account" v-model="draft.saleAccountId" :aria-label="t('financeAssets.dispose.saleAccount')" :invalid="!!shown.saleAccountId" />
      </UFormField>
      <UFormField :label="t('financeAssets.dispose.plusAccount')" name="finance-asset-dispose-plus" :help="t('financeAssets.dispose.defaultHelp')">
        <AccountPicker id="finance-asset-dispose-plus" v-model="draft.plusAccountId" :aria-label="t('financeAssets.dispose.plusAccount')" />
      </UFormField>
      <UFormField :label="t('financeAssets.dispose.minAccount')" name="finance-asset-dispose-min" :help="t('financeAssets.dispose.defaultHelp')">
        <AccountPicker id="finance-asset-dispose-min" v-model="draft.minAccountId" :aria-label="t('financeAssets.dispose.minAccount')" />
      </UFormField>
      <UFormField :label="t('financeAssets.dispose.note')" name="finance-asset-dispose-note" class="sm:col-span-2">
        <UInput id="finance-asset-dispose-note" v-model="draft.note" class="w-full" maxlength="255" :disabled="!hydrated || dispose.isPending.value" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="dispose.isPending.value" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="error" :disabled="!hydrated" :loading="dispose.isPending.value" :label="t(sale ? 'financeAssets.dispose.submitSale' : 'financeAssets.dispose.submitScrap')" data-testid="finance-asset-dispose-submit" />
    </div>
  </UForm>
</template>
