<script setup lang="ts">
import type { ProductSettings, ProductSharing } from '@liwan/contracts'
import { useProductSharingCard } from '@/composables/products/useProductSharingCard'

// Whether products belong to the whole establishment or to one branch. The consequences of sharing are stated before
// the choice. While products exist the mode cannot change yet: the refusal keeps the saved value.
const props = defineProps<{ settings: ProductSettings; canEdit: boolean; reloadSettings: () => Promise<ProductSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload, transferRequired } = useProductSharingCard({ settings: () => props.settings, reload: () => props.reloadSettings() })
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const modes: ProductSharing[] = ['branch', 'establishment']
const items = computed(() => modes.map(value => ({
  value,
  label: t(`products.settings.sharing.${value}`),
  description: t(`products.settings.sharing.${value}Hint`),
})))
</script>

<template>
  <SharedSettingsCard id="sharing" v-bind="state" :title="t('products.settings.sharing.title')" :description="t('products.settings.sharing.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedOptionCards v-model="draft.sharing" :options="items" :disabled="locked" :label="t('products.settings.sharing.title')" data-testid="products-sharing" />
    <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('products.settings.sharing.shareTitle')" data-testid="products-sharing-notice">
      <template #description>
        <ul class="list-disc ps-5">
          <li>{{ t('products.settings.sharing.shareRoot') }}</li>
          <li>{{ t('products.settings.sharing.shareBranch') }}</li>
        </ul>
      </template>
    </UAlert>
    <UAlert v-if="transferRequired" role="alert" color="error" variant="subtle" :title="t('products.settings.sharing.transferTitle')" :description="t('products.settings.sharing.transferRequired')" data-testid="products-sharing-transfer" />
  </SharedSettingsCard>
</template>
