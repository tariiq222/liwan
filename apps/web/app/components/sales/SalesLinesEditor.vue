<script setup lang="ts">
import type { ProductPick, SalesLineKind } from '@liwan/contracts'
import { SALES_LIMITS } from '@liwan/contracts'
import type { SalesLineField } from '@/composables/sales/salesErrors'
import { moveSalesLine, newSalesLine, salesLinePreview, withPickedProduct, type SalesDraftErrors, type SalesLineDraft } from '@/composables/sales/salesOrderDraft'
import { formatCurrency } from '@/utils/formatCurrency'

// The lines of a quotation, one card per line in order. A product line picks a product of the products service, shows
// its unit price read-only and the line's preview before tax, and takes a quantity and a discount; the server prices
// the line on save. Section and note lines take a text. Lines are added, removed and moved with buttons.
const props = defineProps<{
  modelValue: SalesLineDraft[]
  errors: SalesDraftErrors['lines']
  /** A refusal of the server on one line, shown at its field. */
  refused?: { index: number; field: SalesLineField; message: string } | null
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [lines: SalesLineDraft[]] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const off = computed(() => props.disabled || !hydrated.value)

const set = (lines: SalesLineDraft[]) => emit('update:modelValue', lines)
const patch = (index: number, change: Partial<SalesLineDraft>) => set(props.modelValue.map((line, at) => at === index ? { ...line, ...change } : line))
const pick = (index: number, product: ProductPick | null) => set(props.modelValue.map((line, at) => at === index ? withPickedProduct(line, product) : line))
const add = (kind: SalesLineKind) => set([...props.modelValue, newSalesLine(kind)])
const remove = (index: number) => set(props.modelValue.filter((_, at) => at !== index))
const move = (index: number, delta: number) => set(moveSalesLine(props.modelValue, index, delta))

const money = (amount: number, currency: string | null) => currency ? formatCurrency(amount, currency, locale.value) : String(amount)
function errorAt(index: number, problem: 'product' | 'quantity' | 'discount' | 'name', field: SalesLineField) {
  if (props.refused?.index === index && props.refused.field === field) return props.refused.message
  return props.errors[index]?.[problem] ? t(`sales.lines.errors.${problem}`) : undefined
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="sales-lines">
    <p v-if="!props.modelValue.length" class="text-sm text-muted">{{ t('sales.lines.empty') }}</p>
    <SharedSubCard v-for="(line, index) in props.modelValue" :key="line.key" :data-testid="`sales-line-${index}`">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-medium text-highlighted">{{ t(`sales.lines.kind.${line.kind}`) }} {{ index + 1 }}</span>
        <div class="flex items-center gap-1">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-up" :aria-label="t('sales.lines.moveUp')" :disabled="off || index === 0" @click="move(index, -1)" />
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-down" :aria-label="t('sales.lines.moveDown')" :disabled="off || index === props.modelValue.length - 1" @click="move(index, 1)" />
          <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="t('sales.lines.remove')" :disabled="off" :data-testid="`sales-line-remove-${index}`" @click="remove(index)" />
        </div>
      </div>
      <template v-if="line.kind === 'product'">
        <UFormField :label="t('sales.lines.product')" :error="errorAt(index, 'product', 'product_id')" required>
          <div v-if="line.productId" class="flex flex-wrap items-center justify-between gap-2">
            <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ line.productName }}</span>
            <UButton color="neutral" variant="outline" size="sm" :label="t('sales.lines.changeProduct')" :disabled="off" @click="pick(index, null)" />
          </div>
          <SharedProductPicker v-else :model-value="null" :disabled="props.disabled" :aria-label="t('sales.lines.product')" @resolve="product => pick(index, product)" />
        </UFormField>
        <div class="liwan-auto-grid [--liwan-auto-grid-min:10rem]">
          <UFormField :label="t('sales.lines.quantity')" :error="errorAt(index, 'quantity', 'quantity')" required>
            <UInput :model-value="line.quantity" type="number" inputmode="decimal" min="0" step="any" dir="ltr" class="w-full" :disabled="off" :data-testid="`sales-line-quantity-${index}`" @update:model-value="value => patch(index, { quantity: String(value) })" />
          </UFormField>
          <UFormField :label="t('sales.lines.discount')" :error="errorAt(index, 'discount', 'discount_percent')">
            <UInput :model-value="line.discount" type="number" inputmode="decimal" min="0" max="100" step="any" dir="ltr" class="w-full" :disabled="off" :data-testid="`sales-line-discount-${index}`" @update:model-value="value => patch(index, { discount: String(value) })" />
          </UFormField>
          <UFormField :label="t('sales.lines.unitPrice')" :help="t('sales.lines.unitPriceHint')">
            <p class="py-1.5 text-sm text-highlighted"><bdi dir="ltr">{{ line.unitPrice === null ? '—' : money(line.unitPrice, line.currency) }}</bdi></p>
          </UFormField>
          <UFormField :label="t('sales.lines.preview')">
            <p class="py-1.5 text-sm font-semibold text-highlighted" :data-testid="`sales-line-preview-${index}`"><bdi dir="ltr">{{ money(salesLinePreview(line), line.currency) }}</bdi></p>
          </UFormField>
        </div>
      </template>
      <UFormField v-else :label="t(`sales.lines.text.${line.kind}`)" :error="errorAt(index, 'name', 'name')" required>
        <UInput v-if="line.kind === 'section'" :model-value="line.name" class="w-full" :maxlength="SALES_LIMITS.lineName" :disabled="off" :data-testid="`sales-line-name-${index}`" @update:model-value="value => patch(index, { name: String(value) })" />
        <UTextarea v-else :model-value="line.name" class="w-full" :rows="2" autoresize :maxlength="SALES_LIMITS.lineName" :disabled="off" :data-testid="`sales-line-name-${index}`" @update:model-value="value => patch(index, { name: String(value) })" />
      </UFormField>
    </SharedSubCard>
    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :label="t('sales.lines.addProduct')" :disabled="off" data-testid="sales-line-add-product" @click="add('product')" />
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-heading" :label="t('sales.lines.addSection')" :disabled="off" data-testid="sales-line-add-section" @click="add('section')" />
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-sticky-note" :label="t('sales.lines.addNote')" :disabled="off" data-testid="sales-line-add-note" @click="add('note')" />
    </div>
  </div>
</template>
