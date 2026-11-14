<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { PRODUCT_LIMITS, type Product, type ProductType } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { productManagedReason, productFormField, productAlertVisible, type ProductFormField } from '@/composables/products/productErrors'
import { useNewProductManagedElsewhere, useProductManagedElsewhere } from '@/composables/products/productManagement'
import { productCreateBody, productPatchBody, type ProductAbilities, type ProductDraft, type ProductImageChange } from '@/composables/products/productPayload'
import { useCreateProduct, useUpdateProduct } from '@/composables/products/useProducts'
import { useProductTaxChoices } from '@/composables/products/useProductTaxChoices'
import ProductImageField from './ProductImageField.vue'
import ProductTaxField from './ProductTaxField.vue'

// The create and edit form of a product. What a user may change follows two separate rights: the definition
// (`products.manage`) and the price (`products.prices.manage`). A holder of the price right alone changes the price and
// nothing else; a holder of the definition right alone sees the price read-only. A product another company manages is
// read-only with the reason, instead of failing on save.
const props = defineProps<{ product?: Product | null; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [product: Product] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const abilities = computed<ProductAbilities>(() => ({ manage: can('products.manage'), prices: can('products.prices.manage') }))
// A new product is refused before the user types when this session could not save it (a shared product in a branch).
const ownerElsewhere = useProductManagedElsewhere(() => props.product)
const newElsewhere = useNewProductManagedElsewhere(() => !props.product)
const managedElsewhere = computed(() => props.product ? ownerElsewhere.value : newElsewhere.value)

const name = ref('')
const type = ref<ProductType>('service')
const description = ref('')
const price = ref<number | null>(null)
const taxId = ref<number | null>(null)
const image = ref<ProductImageChange>({ kind: 'keep' })
const nameError = ref<string>()
watch(name, () => { nameError.value = undefined })

// A new product offers a tax only when the establishment has taxes to choose from; an existing one when it carries the key.
const taxChoices = useProductTaxChoices(() => abilities.value.manage && !managedElsewhere.value && (!props.product || props.product.taxes !== undefined))
const choices = computed(() => taxChoices.data.value?.items ?? [])
const taxOffered = computed(() => props.product ? props.product.taxes !== undefined : choices.value.length > 0)
const priceOffered = computed(() => !!props.product || abilities.value.prices)

const savedState = ref('')
const snapshot = () => JSON.stringify([name.value, type.value, description.value, price.value, taxId.value, image.value.kind === 'set' ? image.value.image.data.length : image.value.kind])
const dirty = computed(() => savedState.value !== snapshot())
// A refetch hands the form the same product again: it must not wipe what the user typed, so the draft is replaced only
// for another product or while nothing was typed.
let initialised = false
watch(() => props.product, (product, previous) => {
  if (initialised && previous?.id === product?.id && dirty.value) return
  initialised = true
  name.value = product?.name ?? ''
  type.value = product?.type ?? 'service'
  description.value = product?.description ?? ''
  price.value = product?.list_price ?? null
  taxId.value = null
  image.value = { kind: 'keep' }
  savedState.value = snapshot()
}, { immediate: true })

const formError = ref<unknown>(null)
const managedReason = computed(() => productManagedReason(formError.value))
const errorMessage = computed(() => managedReason.value
  ? t(`products.managed.${managedReason.value}`)
  : formError.value ? saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain')) : undefined)
const refused = computed(() => productFormField(formError.value))
const fieldErrors = computed<Record<ProductFormField, string>>(() => ({
  name: t('products.form.errors.name'),
  type: t('products.form.errors.type'),
  list_price: t('products.form.errors.list_price'),
  description: t('products.form.errors.description'),
  image: t('products.form.errors.image'),
  taxes: t('products.form.errors.taxes'),
}))
const errorAt = (field: ProductFormField) => refused.value === field ? fieldErrors.value[field] : undefined
const renderedFields = computed(() => {
  const shown = new Set<ProductFormField>(['name', 'type', 'description', 'image'])
  if (priceOffered.value) shown.add('list_price')
  if (taxOffered.value) shown.add('taxes')
  return shown
})
const alertVisible = computed(() => productAlertVisible(formError.value, renderedFields.value))

const { mutateAsync: create, isPending: creating } = useCreateProduct()
const { mutateAsync: update, isPending: updating } = useUpdateProduct()
const pending = computed(() => creating.value || updating.value)
const locked = computed(() => !hydrated.value || pending.value || !!managedElsewhere.value)
const definitionOff = computed(() => locked.value || !abilities.value.manage)
const priceOff = computed(() => locked.value || !abilities.value.prices)
const submitOff = computed(() => definitionOff.value && priceOff.value)

const draftOf = (): ProductDraft => ({ name: name.value, type: type.value, description: description.value, price: price.value, taxId: taxId.value, image: image.value })
// An edit that changes nothing saves nothing and returns the product as it is.
async function edit(product: Product) {
  const patch = productPatchBody(product, draftOf(), abilities.value)
  return Object.keys(patch).length ? update({ id: product.id, patch }) : product
}

let submitting = false
async function submit() {
  if (submitOff.value || submitting) return
  if (abilities.value.manage && !name.value.trim()) {
    nameError.value = t('products.form.nameRequired')
    await nextTick()
    document.getElementById('product-name')?.focus()
    return
  }
  submitting = true
  formError.value = null
  try {
    const saved = props.product ? await edit(props.product) : await create(productCreateBody(draftOf(), abilities.value))
    savedState.value = snapshot()
    emit('saved', saved)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}

const typeItems = computed(() => [
  { value: 'service', label: t('products.type.service') },
  { value: 'goods', label: t('products.type.goods') },
])
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, price }" class="liwan-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="managedElsewhere" color="info" variant="subtle" icon="i-lucide-lock" :title="t('products.managed.title')" :description="t(`products.managed.${managedElsewhere}`)" data-testid="product-managed-elsewhere" />
    <UAlert v-else-if="props.product && !abilities.manage && abilities.prices" color="info" variant="subtle" icon="i-lucide-banknote" :title="t('products.form.priceOnly')" data-testid="product-price-only" />
    <UAlert v-if="alertVisible" role="alert" color="error" variant="subtle" :title="t('products.form.saveError')" :description="errorMessage" />
    <SharedFormSection panel :title="t('products.form.definition')" :description="t('products.form.definitionHint')">
      <div class="liwan-auto-grid [--liwan-auto-grid-min:20rem]">
        <UFormField :label="t('products.form.name')" name="product-name" required :error="nameError ?? errorAt('name')">
          <UInput id="product-name" v-model="name" class="w-full" :maxlength="PRODUCT_LIMITS.name" :disabled="definitionOff" required data-testid="product-name" />
        </UFormField>
        <UFormField :label="t('products.form.type')" name="product-type" :error="errorAt('type')">
          <USelect v-model="type" :items="typeItems" class="w-full" :disabled="definitionOff" data-testid="product-type" />
        </UFormField>
        <UFormField v-if="priceOffered" :label="t('products.form.price')" name="product-price" :error="errorAt('list_price')" :help="abilities.prices ? t('products.form.priceHint') : t('products.form.priceNeedsRight')">
          <UInputNumber id="product-price" v-model="price" class="w-full" :min="0" :max="PRODUCT_LIMITS.price" :disabled="priceOff" data-testid="product-price" />
        </UFormField>
        <ProductTaxField v-if="taxOffered" v-model="taxId" :taxes="props.product?.taxes" :choices="choices" :disabled="definitionOff" :error="errorAt('taxes')" />
      </div>
      <UFormField :label="t('products.form.description')" name="product-description" :error="errorAt('description')">
        <UTextarea id="product-description" v-model="description" class="w-full" :rows="3" autoresize :maxlength="PRODUCT_LIMITS.description" :disabled="definitionOff" data-testid="product-description" />
      </UFormField>
      <ProductImageField v-model="image" :stored="props.product?.has_image ?? false" :disabled="definitionOff" :error="errorAt('image')" />
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="submitOff" :loading="pending" :label="t(props.product ? 'app.saveChanges' : 'app.create')" data-testid="product-submit" />
    </SharedFormActions>
  </UForm>
</template>
