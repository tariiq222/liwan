<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { SALES_LIMITS, type CustomerPick, type SalesOrder } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { salesFormField, salesRefusalKey, type SalesOrderField } from '@/composables/sales/salesErrors'
import { emptySalesDraft, hasSalesDraftErrors, salesCreateBody, salesDraftFromOrder, salesDraftSnapshot, salesPatchBody, validateSalesDraft, type SalesDraftErrors, type SalesOrderDraft } from '@/composables/sales/salesOrderDraft'
import { useCreateSalesOrder, useSalesSalespeople, useUpdateSalesOrder } from '@/composables/sales/useSalesOrders'
import SalesLinesEditor from './SalesLinesEditor.vue'

// The create form of the route-backed panel and the edit page of a quotation: the customer, the salesperson (for a
// holder of the assign right), the validity date, the terms and the lines. The body carries no price and no tax; the
// server prices every product line. A refusal on a field is shown at that field, any other at the top.
const props = defineProps<{ order?: SalesOrder | null; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [order: SalesOrder] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canAssign = computed(() => can('sales.documents.assign'))
const salespeople = useSalesSalespeople(canAssign)
const salespersonItems = computed(() => (salespeople.data.value?.items ?? []).map(person => ({ value: person.id, label: person.name })))

const draft = ref<SalesOrderDraft>(emptySalesDraft())
const savedState = ref('')
const dirty = computed(() => savedState.value !== salesDraftSnapshot(draft.value))
// A refetch hands the form the same order again: it must not wipe what the user typed.
let initialised = false
watch(() => props.order, (order, previous) => {
  if (initialised && previous?.id === order?.id && dirty.value) return
  initialised = true
  draft.value = order ? salesDraftFromOrder(order) : emptySalesDraft()
  savedState.value = salesDraftSnapshot(draft.value)
}, { immediate: true })

const checked = ref<SalesDraftErrors | null>(null)
const errors = computed<SalesDraftErrors>(() => checked.value ? validateSalesDraft(draft.value) : { customer: false, noLines: false, lines: [] })
const formError = ref<unknown>(null)
watch(draft, () => { formError.value = null }, { deep: true })
const refusedField = computed(() => salesFormField(formError.value))
const refusalMessage = computed(() => {
  if (!formError.value) return ''
  const key = salesRefusalKey(formError.value)
  return key ? t(key) : saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain'))
})
const refusedLine = computed(() => refusedField.value?.kind === 'line' && refusedField.value.index < draft.value.lines.length
  ? { index: refusedField.value.index, field: refusedField.value.field, message: refusalMessage.value }
  : null)
const headerError = (field: SalesOrderField) => refusedField.value?.kind === 'order' && refusedField.value.field === field ? refusalMessage.value : undefined
const alertVisible = computed(() => !!formError.value && !refusedLine.value && !(refusedField.value?.kind === 'order' && (refusedField.value.field !== 'salesperson_id' || canAssign.value)))

const { mutateAsync: create, isPending: creating } = useCreateSalesOrder()
const { mutateAsync: update, isPending: updating } = useUpdateSalesOrder()
const pending = computed(() => creating.value || updating.value)
const off = computed(() => !hydrated.value || pending.value)

function customerChosen(customer: CustomerPick | null) { draft.value.customerName = customer?.name ?? '' }

let submitting = false
async function submit() {
  if (off.value || submitting) return
  checked.value = validateSalesDraft(draft.value)
  if (hasSalesDraftErrors(checked.value)) return
  submitting = true
  formError.value = null
  try {
    const saved = props.order
      ? await update({ id: props.order.id, patch: salesPatchBody(props.order, draft.value, canAssign.value) })
      : await create(salesCreateBody(draft.value, canAssign.value))
    savedState.value = salesDraftSnapshot(draft.value)
    emit('saved', saved)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="draft" class="liwan-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="alertVisible" role="alert" color="error" variant="subtle" :title="t('sales.form.saveError')" :description="refusalMessage" data-testid="sales-form-error" />
    <SharedFormSection panel :title="t('sales.form.header')" :description="t('sales.form.headerHint')">
      <div class="liwan-auto-grid liwan-field-grid">
        <UFormField class="liwan-span-full" :label="t('sales.form.customer')" name="sales-customer" required :error="errors.customer ? t('sales.form.customerRequired') : headerError('customer_id')">
          <SharedCustomerPicker v-model="draft.customerId" :selected="draft.customerId ? { id: draft.customerId, name: draft.customerName } : null" :disabled="off" :aria-label="t('sales.form.customer')" @resolve="customerChosen" />
        </UFormField>
        <div class="liwan-auto-grid [--liwan-auto-grid-min:16rem]">
          <UFormField v-if="canAssign" :label="t('sales.form.salesperson')" name="sales-salesperson" :help="t('sales.form.salespersonHint')" :error="headerError('salesperson_id')">
            <USelect :model-value="draft.salespersonId ?? undefined" :items="salespersonItems" class="w-full" :placeholder="t('sales.form.salespersonPlaceholder')" :loading="salespeople.isLoading.value" :disabled="off" data-testid="sales-salesperson" @update:model-value="value => { draft.salespersonId = value ?? null }" />
          </UFormField>
          <UFormField :label="t('sales.form.validity')" name="sales-validity" :help="props.order ? undefined : t('sales.form.validityHint')" :error="headerError('validity_date')">
            <SharedDateField v-model="draft.validityDate" :disabled="off" data-testid="sales-validity" />
          </UFormField>
        </div>
        <UFormField :label="t('sales.form.terms')" name="sales-terms" :help="props.order ? undefined : t('sales.form.termsHint')" :error="headerError('terms')">
          <UTextarea v-model="draft.terms" class="w-full" :rows="3" autoresize :maxlength="SALES_LIMITS.terms" :disabled="off" data-testid="sales-terms" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('sales.form.lines')" :description="t('sales.form.linesHint')">
      <p v-if="errors.noLines" role="alert" class="text-sm text-error">{{ t('sales.lines.errors.none') }}</p>
      <SalesLinesEditor v-model="draft.lines" :errors="errors.lines" :refused="refusedLine" :disabled="off" />
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="off" :loading="pending" :label="t(props.order ? 'app.saveChanges' : 'sales.form.create')" data-testid="sales-submit" />
    </SharedFormActions>
  </UForm>
</template>
