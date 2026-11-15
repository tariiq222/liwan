<script setup lang="ts">
import ProductSharingCard from '@/components/products/settings/ProductSharingCard.vue'
import { useProductSettings } from '@/composables/products/useProductSettings'

// The products service's settings under Settings > Applications: one card per setting. Reading needs `products.read`
// or `products.settings.manage`; changing needs the capability in the main company as well, which the server reports as
// `can_manage`. Without it the whole page is read-only and says why. Each card saves only its own fields with the
// revision it was made from, through the page's one save bar.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('products')
const settings = useProductSettings()
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('products.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState empty-icon="i-lucide-settings" :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <template v-if="settings.data.value">
          <UAlert v-if="!settings.data.value.can_manage" color="info" variant="subtle" icon="i-lucide-lock" :title="t('products.settings.readOnlyTitle')" :description="t('products.settings.readOnly')" data-testid="products-settings-readonly" />
          <ProductSharingCard v-if="shows('sharing')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
