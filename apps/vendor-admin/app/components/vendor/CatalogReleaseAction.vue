<script setup lang="ts">
import { commercialErrorKey } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
const props = defineProps<{ version: string }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n(); const hydrated = useHydrated(); const { can } = useVendorContext(); const api = useVendorCommercial()
const reason = ref(''); const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null)
const reasonError = computed(() => (attempted.value && (reason.value.trim().length < 3 || reason.value.trim().length > 1000) ? t('vendor.pricing.reasonRequired') : undefined))
async function perform() {
  if (!hydrated.value || busy.value) return
  attempted.value = true
  if (reasonError.value) return
  busy.value = true; failure.value = null
  try { await api.createRelease({ catalog_version: props.version, reason: reason.value.trim() }); reason.value = ''; attempted.value = false; emit('done') } catch (cause) { failure.value = cause } finally { busy.value = false }
}
</script>
<template>
  <SharedFormSection :title="t('vendor.catalog.release.title')" :description="t('vendor.catalog.release.hint')" data-testid="catalog-release">
    <SharedUnsavedChanges :dirty="Boolean(reason.trim())" guard-route-updates />
    <p v-if="!can('vendor.catalog.manage')" class="text-sm text-muted" data-testid="catalog-release-blocked">{{ t('vendor.pricing.blocked.catalog') }}</p>
    <form v-else class="space-y-4" novalidate data-testid="catalog-release-form" @submit.prevent="perform">
      <UAlert v-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(failure))" />
      <UFormField :label="t('vendor.pricing.fields.reason')" required :error="reasonError"><UTextarea v-model="reason" maxlength="1000" class="w-full" data-testid="catalog-release-reason" :disabled="!hydrated || busy" /></UFormField>
      <div class="flex justify-end"><UButton type="submit" data-testid="catalog-release-submit" :loading="busy" :disabled="!hydrated || busy">{{ t('vendor.bundles.createRelease') }}</UButton></div>
    </form>
  </SharedFormSection>
</template>
