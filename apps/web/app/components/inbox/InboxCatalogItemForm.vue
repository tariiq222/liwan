<script setup lang="ts">
import {
  InboxCatalogItemCreateSchema, InboxCatalogItemPatchSchema, InboxRetailerIdSchema, INBOX_COMMERCE_LIMITS,
  type InboxCatalogImageUpload, type InboxCatalogItem,
} from '@webvue/contracts'
import { fileToBase64 } from '@/utils/attachmentFile'
import { CATALOG_IMAGE_ACCEPT, formatInboxMoney, imageProblem, measureImage, type ImageProblem } from '@/composables/inbox/inboxCommerce'
import { useCreateInboxCatalogItem, useInboxCatalogProducts, usePatchInboxCatalogItem } from '@/composables/inbox/useInboxCatalog'

// Adds a product to the catalog (an existing product, or a new one made here with a picture) or edits an item. The picture
// is checked in the browser before it is uploaded: JPEG or PNG, at least 500 by 500 pixels, at most 5 MB. A new product
// needs a picture (Meta requires one). Editing the product's own fields works only for a product made by this editor; the
// server says so otherwise. The retailer id (Meta's content id) is fixed once the item was synced.
const props = defineProps<{ catalogId: number; backTo: string; item?: InboxCatalogItem; currency?: string }>()
const emit = defineEmits<{ saved: [item: InboxCatalogItem] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const limits = INBOX_COMMERCE_LIMITS
const { mutateAsync: create, isPending: creating } = useCreateInboxCatalogItem(() => props.catalogId)
const { mutateAsync: patch, isPending: patching } = usePatchInboxCatalogItem()
const pending = computed(() => creating.value || patching.value)

const tab = ref<'existing' | 'new'>('existing')
const productId = ref<number | null>(null)
const productQuery = ref('')
const products = useInboxCatalogProducts(() => (props.item ? null : props.catalogId), productQuery)
const name = ref(props.item?.name ?? '')
const description = ref(props.item?.description ?? '')
const listPrice = ref<number | null>(props.item?.list_price ?? null)
const retailerId = ref(props.item?.product_retailer_id ?? '')
const availability = ref<'in_stock' | 'out_of_stock'>(props.item?.availability ?? 'in_stock')
const listed = ref(props.item?.listed ?? true)
const linkOverride = ref(props.item?.link_override ?? '')
const image = ref<{ upload: InboxCatalogImageUpload | null; preview: string; problem: ImageProblem | null; reading: boolean; size: string } | null>(null)
const attempted = ref(false)
const saved = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)

const editing = computed(() => !!props.item)
const synced = computed(() => !!props.item?.last_synced_at)
const off = computed(() => !hydrated.value || pending.value)
const money = computed(() => formatInboxMoney(listPrice.value ?? 0, props.item?.currency ?? props.currency ?? 'SAR', locale.value))
const tabItems = computed(() => (['existing', 'new'] as const).map(value => ({ value, label: t(`inbox.catalog.itemForm.tabs.${value}`) })))
const availabilityItems = computed(() => (['in_stock', 'out_of_stock'] as const).map(value => ({ value, label: t(`inbox.catalog.availability.${value}`) })))
const previewSrc = computed(() => image.value?.preview ?? props.item?.image?.url ?? null)

const common = computed(() => ({
  ...(retailerId.value.trim() ? { product_retailer_id: retailerId.value.trim() } : {}),
  availability: availability.value, listed: listed.value, link_override: linkOverride.value.trim() || null,
}))
const productFields = computed(() => ({ name: name.value.trim(), description: description.value.trim() || null, list_price: listPrice.value ?? 0 }))
const createBody = computed(() => (tab.value === 'existing'
  ? { product_id: productId.value, ...common.value }
  : { product: { ...productFields.value, image: image.value?.upload }, ...common.value }))
const patchBody = computed(() => {
  const item = props.item!
  const product = {
    ...(name.value.trim() !== item.name ? { name: name.value.trim() } : {}),
    ...((description.value.trim() || '') !== item.description ? { description: description.value.trim() || null } : {}),
    ...(listPrice.value !== null && listPrice.value !== item.list_price ? { list_price: listPrice.value } : {}),
    ...(image.value?.upload ? { image: image.value.upload } : {}),
  }
  return {
    ...(!synced.value && retailerId.value.trim() !== item.product_retailer_id ? { product_retailer_id: retailerId.value.trim() } : {}),
    ...(availability.value !== item.availability ? { availability: availability.value } : {}),
    ...(listed.value !== item.listed ? { listed: listed.value } : {}),
    ...((linkOverride.value.trim() || null) !== item.link_override ? { link_override: linkOverride.value.trim() || null } : {}),
    ...(Object.keys(product).length ? { product } : {}),
  }
})
const parsed = computed(() => (editing.value ? InboxCatalogItemPatchSchema.safeParse(patchBody.value) : InboxCatalogItemCreateSchema.safeParse(createBody.value)))
const retailerValid = computed(() => !retailerId.value.trim() || InboxRetailerIdSchema.safeParse(retailerId.value.trim()).success)
const dirty = computed(() => !saved.value && (editing.value ? Object.keys(patchBody.value).length > 0 : !!productId.value || !!name.value.trim() || !!image.value))
const imageMissing = computed(() => !editing.value && tab.value === 'new' && !image.value?.upload)
const retailerError = computed(() => (serverError.value?.field === 'product_retailer_id' ? serverError.value.message : attempted.value && !retailerValid.value ? t('inbox.catalog.itemForm.invalid.retailerId') : undefined))

async function onImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (image.value) URL.revokeObjectURL(image.value.preview)
  const state = { upload: null, preview: URL.createObjectURL(file), problem: imageProblem(file, null), reading: true, size: '' } as NonNullable<typeof image.value>
  image.value = state
  if (state.problem) { state.reading = false; return }
  const size = await measureImage(file)
  state.size = size ? `${size.width}×${size.height}` : ''
  state.problem = size ? imageProblem(file, size) : 'type'
  if (!state.problem) state.upload = { name: file.name, mimetype: file.type as InboxCatalogImageUpload['mimetype'], data: await fileToBase64(file) }
  state.reading = false
}
onBeforeUnmount(() => { if (image.value) URL.revokeObjectURL(image.value.preview) })

async function submit() {
  attempted.value = true
  serverError.value = null
  if (off.value || image.value?.reading || !parsed.value.success || imageMissing.value || !retailerValid.value || image.value?.problem) return
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
  <form class="flex flex-col gap-4" novalidate data-testid="inbox-catalog-item-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedSegmentedControl v-if="!editing" v-model="tab" class="self-start" :items="tabItems" :label="t('inbox.catalog.itemForm.source')" />

    <div v-if="!editing && tab === 'existing'" class="flex flex-col gap-2" data-testid="inbox-item-existing">
      <UFormField :label="t('inbox.catalog.itemForm.productId')" :description="t('inbox.catalog.itemForm.productIdHint')" required :error="serverError?.field === 'product_id' ? serverError.message : attempted && !productId ? t('inbox.catalog.itemForm.invalid.productId') : undefined">
        <UInput v-model="productQuery" class="w-full" icon="i-lucide-search" :placeholder="t('inbox.catalog.itemForm.searchProducts')" :disabled="off" data-testid="inbox-item-product-search" />
      </UFormField>
      <SharedLoadingSkeleton v-if="products.isPending.value" />
      <SharedPageState v-else-if="products.error.value" :error="products.error.value" @retry="products.refetch()" />
      <p v-else-if="!products.data.value?.items.length" class="text-sm text-muted" data-testid="inbox-item-products-empty">{{ t('inbox.catalog.itemForm.noProducts') }}</p>
      <ul v-else class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-control ring ring-default" :aria-label="t('inbox.catalog.itemForm.productList')">
        <li v-for="option in products.data.value.items" :key="option.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            :class="{ 'bg-(--brand-soft)': productId === option.id }"
            :aria-pressed="productId === option.id"
            :disabled="off || !option.has_image || option.listed"
            :data-testid="`inbox-item-product-${option.id}`"
            @click="productId = productId === option.id ? null : option.id"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-highlighted">{{ option.name }}</span>
              <span class="block truncate text-xs text-muted">{{ formatInboxMoney(option.list_price, option.currency, locale) }}<template v-if="option.listed"> · {{ t('inbox.catalog.itemForm.alreadyListed') }}</template><template v-else-if="!option.has_image"> · {{ t('inbox.catalog.itemForm.noImage') }}</template></span>
            </span>
            <UIcon :name="productId === option.id ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-5 shrink-0" :class="productId === option.id ? 'text-primary' : 'text-muted'" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <template v-if="editing || tab === 'new'">
      <UFormField :label="t('inbox.catalog.itemForm.name')" required :error="serverError?.field === 'product.name' ? serverError.message : attempted && !name.trim() ? t('inbox.settings.requiredName') : undefined">
        <UInput v-model="name" class="w-full" :maxlength="limits.productName" :disabled="off" data-testid="inbox-item-name" />
      </UFormField>
      <UFormField :label="t('inbox.catalog.itemForm.description')" :hint="`${description.length}/${limits.productDescription}`">
        <UTextarea v-model="description" class="w-full" :rows="3" autoresize :maxrows="8" :maxlength="limits.productDescription" :disabled="off" data-testid="inbox-item-description" />
      </UFormField>
      <UFormField :label="t('inbox.catalog.itemForm.price')" :description="t('inbox.catalog.itemForm.priceHint')" required :error="serverError?.field === 'product.list_price' ? serverError.message : undefined">
        <UInput :model-value="listPrice ?? undefined" type="number" :min="0" step="0.01" class="w-full" dir="ltr" :disabled="off" data-testid="inbox-item-price" @update:model-value="listPrice = String($event ?? '') === '' ? null : Number($event)" />
      </UFormField>
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-highlighted">{{ t('inbox.catalog.itemForm.image') }} <span v-if="!editing" class="text-error" aria-hidden="true">*</span></p>
        <p class="text-xs text-muted">{{ t('inbox.catalog.itemForm.imageHint', { min: limits.imageMinSide, mb: limits.imageBytes / 1048576 }) }}</p>
        <SharedFileField :accept="CATALOG_IMAGE_ACCEPT" :label="t('inbox.catalog.itemForm.pickImage')" :show-file-name="false" :disabled="off" data-testid="inbox-item-image" @change="onImage" />
        <p v-if="image?.reading" class="text-xs text-muted" role="status">{{ t('inbox.composer.uploading') }}</p>
        <p v-if="image?.problem" class="text-sm text-error" role="alert" data-testid="inbox-item-image-problem">{{ t(`inbox.catalog.itemForm.imageProblems.${image.problem}`, { min: limits.imageMinSide, mb: limits.imageBytes / 1048576 }) }}</p>
        <p v-else-if="image?.size" class="text-xs text-muted"><bdi dir="ltr">{{ image.size }}</bdi></p>
        <p v-if="attempted && imageMissing && !image" class="text-sm text-error" role="alert">{{ t('inbox.catalog.itemForm.imageRequired') }}</p>
        <p v-if="serverError?.field === 'product.image'" class="text-sm text-error" role="alert">{{ serverError.message }}</p>
      </div>
      <SharedSubCard tone="tinted" class="flex max-w-xs flex-col gap-1.5" data-testid="inbox-item-preview">
        <p class="text-xs text-muted">{{ t('inbox.catalog.itemForm.preview') }}</p>
        <InboxProductImage :src="previewSrc" class="aspect-square w-full rounded-control" />
        <p class="font-semibold">{{ name || t('inbox.catalog.itemForm.name') }}</p>
        <p class="text-sm">{{ money }}</p>
      </SharedSubCard>
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
