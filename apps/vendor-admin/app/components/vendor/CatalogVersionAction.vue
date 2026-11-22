<script setup lang="ts">
import { catalogActionErrorKey, nextCatalogAction, type CatalogVersion } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
const props = defineProps<{ version: CatalogVersion }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n(); const hydrated = useHydrated(); const { can } = useVendorContext(); const catalog = useVendorCatalogVersions()
const action = computed(() => nextCatalogAction(props.version.status))
const reason = ref(''); const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null)
const reasonError = computed(() => (attempted.value && (reason.value.trim().length < 3 || reason.value.trim().length > 1000) ? t('vendor.pricing.reasonRequired') : undefined))
async function perform() {
  const step = action.value
  if (!hydrated.value || !step || busy.value) return
  attempted.value = true
  if (reasonError.value) return
  busy.value = true; failure.value = null
  try { await catalog.act(props.version.id, step, reason.value.trim()); reason.value = ''; attempted.value = false; emit('done') } catch (cause) { failure.value = cause } finally { busy.value = false }
}
</script>
<template>
  <SharedFormSection v-if="action" :title="t('vendor.catalog.step')" :description="t(`vendor.catalog.effects.${action}`)" data-testid="catalog-action">
    <SharedUnsavedChanges :dirty="Boolean(reason.trim())" guard-route-updates />
    <p v-if="!can('vendor.catalog.manage')" class="text-sm text-muted" data-testid="catalog-action-blocked">{{ t('vendor.pricing.blocked.catalog') }}</p>
    <form v-else class="space-y-4" novalidate data-testid="catalog-action-form" @submit.prevent="perform">
      <UAlert v-if="failure" color="error" variant="subtle" :title="t(catalogActionErrorKey(failure))" />
      <UFormField :label="t('vendor.pricing.fields.reason')" required :error="reasonError"><UTextarea v-model="reason" maxlength="1000" class="w-full" data-testid="catalog-action-reason" :disabled="!hydrated || busy" /></UFormField>
      <div class="flex justify-end"><UButton type="submit" data-testid="catalog-action-submit" :loading="busy" :disabled="!hydrated || busy">{{ t(`vendor.pricing.actions.${action}`) }}</UButton></div>
    </form>
  </SharedFormSection>
</template>
