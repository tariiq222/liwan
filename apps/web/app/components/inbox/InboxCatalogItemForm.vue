<script setup lang="ts">
import {
  InboxCatalogItemCreateSchema, InboxCatalogItemPatchSchema, InboxRetailerIdSchema, INBOX_COMMERCE_LIMITS,
  type InboxCatalogItem,
} from '@liwan/contracts'
import { formatCurrency } from '@/utils/formatCurrency'
import { useCreateInboxCatalogItem, usePatchInboxCatalogItem } from '@/composables/inbox/useInboxCatalog'

// Adds a product of the products list to the catalog, or edits how an item is listed. The product's own name, description,
// price and image come from the products list and are only shown here; Meta needs an image, so the server refuses a
// product without one. The retailer id (Meta's content id) is fixed once the item was synced.
const props = defineProps<{ catalogId: number; backTo: string; item?: InboxCatalogItem }>()
const emit = defineEmits<{ saved: [item: InboxCatalogItem] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const limits = INBOX_COMMERCE_LIMITS
const { mutateAsync: create, isPending: creating } = useCreateInboxCatalogItem(() => props.catalogId)
const { mutateAsync: patch, isPending: patching } = usePatchInboxCatalogItem()
const pending = computed(() => creating.value || patching.value)

const productId = ref<number | null>(null)
const retailerId = ref(props.item?.product_retailer_id ?? '')
const availability = ref<'in_stock' | 'out_of_stock'>(props.item?.availability ?? 'in_stock')
const listed = ref(props.item?.listed ?? true)
const linkOverride = ref(props.item?.link_override ?? '')
const attempted = ref(false)
const saved = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)

const editing = computed(() => !!props.item)
const synced = computed(() => !!props.item?.last_synced_at)
const off = computed(() => !hydrated.value || pending.value)
const availabilityItems = computed(() => (['in_stock', 'out_of_stock'] as const).map(value => ({ value, label: t(`inbox.catalog.availability.${value}`) })))

const common = computed(() => ({
  ...(retailerId.value.trim() ? { product_retailer_id: retailerId.value.trim() } : {}),
  availability: availability.value, listed: listed.value, link_override: linkOverride.value.trim() || null,
}))
const createBody = computed(() => ({ product_id: productId.value, ...common.value }))
const patchBody = computed(() => {
  const item = props.item!
  return {
    ...(!synced.value && retailerId.value.trim() !== item.product_retailer_id ? { product_retailer_id: retailerId.value.trim() } : {}),
    ...(availability.value !== item.availability ? { availability: availability.value } : {}),
    ...(listed.value !== item.listed ? { listed: listed.value } : {}),
    ...((linkOverride.value.trim() || null) !== item.link_override ? { link_override: linkOverride.value.trim() || null } : {}),
  }
})
const parsed = computed(() => (editing.value ? InboxCatalogItemPatchSchema.safeParse(patchBody.value) : InboxCatalogItemCreateSchema.safeParse(createBody.value)))
const retailerValid = computed(() => !retailerId.value.trim() || InboxRetailerIdSchema.safeParse(retailerId.value.trim()).success)
const dirty = computed(() => !saved.value && (editing.value ? Object.keys(patchBody.value).length > 0 : !!productId.value))
const retailerError = computed(() => (serverError.value?.field === 'product_retailer_id' ? serverError.value.message : attempted.value && !retailerValid.value ? t('inbox.catalog.itemForm.invalid.retailerId') : undefined))

async function submit() {
  attempted.value = true
  serverError.value = null
  if (off.value || !parsed.value.success || !retailerValid.value) return
  try {
    const result = props.item
      ? await patch({ id: props.item.id, body: InboxCatalogItemPatchSchema.parse(patchBody.value) })
      : await create(InboxCatalogItemCreateSchema.parse(createBody.value))
    saved.value = true
    toast.add({ title: t('inbox.settings.saved'), color: 'success' })
    emit('saved', result)
  } catch (e) {
    serverError.value = { field: (e as { field?: string }).field, message: e instanceof Error ? e.message : t('errors.generic') }
    toast.add({ title: serverError.value.message, color: 'error' })
  }
}
</script>

<template>
  <form class="liwan-form" novalidate data-testid="inbox-catalog-item-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />

    <UFormField v-if="!editing" :label="t('inbox.catalog.itemForm.productId')" :description="t('inbox.catalog.itemForm.productIdHint')" required :error="serverError?.field === 'product_id' ? serverError.message : attempted && !productId ? t('inbox.catalog.itemForm.invalid.productId') : undefined">
      <SharedProductPicker v-model="productId" :disabled="off" :aria-label="t('inbox.catalog.itemForm.searchProducts')" />
    </UFormField>

    <template v-else>
      <SharedSubCard tone="tinted" class="flex max-w-xs flex-col gap-1.5" data-testid="inbox-item-preview">
        <p class="text-xs text-muted">{{ t('inbox.catalog.itemForm.preview') }}</p>
        <InboxProductImage :src="props.item?.image?.url ?? null" class="aspect-square w-full rounded-control" />
        <p class="font-semibold">{{ props.item?.name }}</p>
        <p class="text-sm">{{ formatCurrency(props.item?.price ?? 0, props.item?.currency ?? 'SAR', locale) }}</p>
      </SharedSubCard>
      <p class="text-sm text-muted" data-testid="inbox-item-product-managed">{{ t('inbox.catalog.itemForm.productManaged') }}</p>
    </template>

    <UFormField :label="t('inbox.catalog.itemForm.retailerId')" :description="synced ? t('inbox.catalog.itemForm.retailerIdLocked') : t('inbox.catalog.itemForm.retailerIdHint')" :error="retailerError">
      <UInput v-model="retailerId" class="w-full" dir="ltr" :maxlength="limits.retailerId" :disabled="off || synced" data-testid="inbox-item-retailer-id" />
    </UFormField>
    <UFormField :label="t('inbox.catalog.itemForm.availability')">
      <USelect v-model="availability" :items="availabilityItems" class="w-full" :disabled="off" />
    </UFormField>
    <UFormField :label="t('inbox.catalog.itemForm.linkOverride')" :description="t('inbox.catalog.itemForm.linkOverrideHint')" :error="serverError?.field === 'link_override' ? serverError.message : undefined">
      <UInput v-model="linkOverride" class="w-full" dir="ltr" type="url" placeholder="https://" :disabled="off" />
    </UFormField>
    <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
      <USwitch v-model="listed" :disabled="off" data-testid="inbox-item-listed" />{{ t('inbox.catalog.itemForm.listed') }}
    </label>

    <div class="flex justify-end gap-2">
      <UButton :to="props.backTo" color="neutral" variant="outline" :disabled="off" :label="t('app.cancel')" />
      <UButton type="submit" :disabled="off || (editing && !dirty)" :loading="pending" :label="editing ? t('app.save') : t('inbox.catalog.itemForm.add')" data-testid="inbox-item-submit" />
    </div>
  </form>
</template>
