<script setup lang="ts">
import { InboxCatalogPatchSchema, type InboxCatalog } from '@liwan/contracts'
import { usePatchInboxCatalog } from '@/composables/inbox/useInboxCatalog'

// The catalog-wide defaults: the brand name Meta shows and the product link used when an item has none (empty sends the
// click-to-chat link of the item's number). A change pushes every item again. The tax is the establishment's one choice
// in the company settings; an item's price is the total the customer pays, which the server computes.
const props = defineProps<{ catalog: InboxCatalog; manage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: patch, isPending } = usePatchInboxCatalog(() => props.catalog.id)
const brand = ref(props.catalog.brand)
const link = ref(props.catalog.default_link ?? '')
watch(() => props.catalog, (catalog) => {
  brand.value = catalog.brand
  link.value = catalog.default_link ?? ''
})
const body = computed(() => ({
  brand: brand.value.trim(),
  default_link: link.value.trim() || null,
}))
const dirty = computed(() => body.value.brand !== props.catalog.brand || body.value.default_link !== props.catalog.default_link)
const valid = computed(() => InboxCatalogPatchSchema.safeParse(body.value).success)
const off = computed(() => !hydrated.value || isPending.value || !props.manage)
function save() {
  if (off.value || !dirty.value || !valid.value) return
  patch(body.value, {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <form @submit.prevent="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedRecordSection variant="panel" :title="t('inbox.catalog.defaults')" :description="t('inbox.catalog.defaultsHint')">
      <div class="flex flex-col gap-4">
        <UFormField :label="t('inbox.catalog.brand')" :description="t('inbox.catalog.brandHint')" required>
          <UInput v-model="brand" class="w-full" maxlength="100" :disabled="off" data-testid="inbox-catalog-edit-brand" />
        </UFormField>
        <UFormField :label="t('inbox.catalog.defaultLink')" :description="t('inbox.catalog.defaultLinkHint')" :error="link.trim() && !valid ? t('inbox.catalog.connect.invalid.link') : undefined">
          <UInput v-model="link" class="w-full" dir="ltr" type="url" placeholder="https://" :disabled="off" data-testid="inbox-catalog-edit-link" />
        </UFormField>
        <div v-if="props.manage" class="flex justify-end">
          <UButton type="submit" :disabled="off || !dirty || !valid" :loading="isPending" :label="t('app.save')" data-testid="inbox-catalog-edit-save" />
        </div>
      </div>
    </SharedRecordSection>
  </form>
</template>
