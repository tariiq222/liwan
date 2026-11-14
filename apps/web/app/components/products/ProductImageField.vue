<script setup lang="ts">
import { PRODUCT_LIMITS, type ProductImage } from '@liwan/contracts'
import { PRODUCT_IMAGE_ACCEPT, productImageBody, productImageProblem, type ProductImageProblem } from '@/composables/products/productImage'
import type { ProductImageChange } from '@/composables/products/productPayload'

// The image of a product: choose a JPEG or PNG, see the new file before saving, or remove the stored one. The API never
// returns the stored file, so a product that already has an image shows only that it has one. The form sends the image
// only when it changed (`modelValue` is not `keep`).
const props = defineProps<{ modelValue: ProductImageChange; stored: boolean; disabled?: boolean; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: ProductImageChange] }>()
const { t, n } = useI18n()
const picker = ref<{ reset: () => void } | null>(null)
const problem = ref<ProductImageProblem | 'unreadable' | null>(null)
const preview = ref<string | null>(null)
const fileName = ref('')

function dropPreview() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = null
}
watch(() => props.modelValue.kind, (kind) => { if (kind !== 'set') dropPreview() })
onBeforeUnmount(dropPreview)

// Each choice is read on its own turn: a file still being read when the user picks another is dropped.
let turn = 0
async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  problem.value = productImageProblem(file)
  if (problem.value) { picker.value?.reset(); return }
  const mine = ++turn
  let image: ProductImage
  try {
    image = await productImageBody(file)
  } catch {
    // The browser could not read the file (it was moved or deleted after it was chosen): nothing is chosen.
    if (mine === turn) { problem.value = 'unreadable'; picker.value?.reset() }
    return
  }
  if (mine !== turn) return
  dropPreview()
  preview.value = URL.createObjectURL(file)
  fileName.value = file.name
  emit('update:modelValue', { kind: 'set', image })
}
function setChange(change: ProductImageChange) {
  turn += 1
  problem.value = null
  picker.value?.reset()
  emit('update:modelValue', change)
}

const status = computed(() => {
  if (props.modelValue.kind === 'set') return t('products.form.image.chosen', { name: fileName.value })
  if (props.modelValue.kind === 'remove') return t('products.form.image.willRemove')
  return t(props.stored ? 'products.form.image.stored' : 'products.form.image.none')
})
const problemText = computed(() => {
  if (problem.value === 'type') return t('products.form.image.badType')
  if (problem.value === 'empty') return t('products.form.image.empty')
  if (problem.value === 'tooLarge') return t('products.form.image.tooLarge', { size: n(PRODUCT_LIMITS.imageBytes / (1024 * 1024)) })
  if (problem.value === 'unreadable') return t('products.form.image.unreadable')
  return props.error
})
</script>

<template>
  <UFormField :label="t('products.form.image.label')" name="product-image" :error="problemText" :help="t('products.form.image.hint', { size: n(PRODUCT_LIMITS.imageBytes / (1024 * 1024)) })">
    <div class="flex flex-wrap items-center gap-3">
      <img v-if="preview" :src="preview" :alt="t('products.form.image.previewAlt')" class="size-16 rounded-control object-cover ring ring-default" data-testid="product-image-preview">
      <span class="min-w-0 text-sm text-muted" data-testid="product-image-status">{{ status }}</span>
      <SharedFileField ref="picker" :accept="PRODUCT_IMAGE_ACCEPT" :label="t('products.form.image.choose')" :show-file-name="false" :disabled="props.disabled" data-testid="product-image-file" @change="choose" />
      <UButton v-if="props.modelValue.kind !== 'keep'" type="button" color="neutral" variant="ghost" icon="i-lucide-undo-2" :disabled="props.disabled" :label="t(props.modelValue.kind === 'set' ? 'products.form.image.discard' : 'products.form.image.keep')" data-testid="product-image-undo" @click="setChange({ kind: 'keep' })" />
      <UButton v-else-if="props.stored" type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :disabled="props.disabled" :label="t('products.form.image.remove')" data-testid="product-image-remove" @click="setChange({ kind: 'remove' })" />
    </div>
  </UFormField>
</template>
