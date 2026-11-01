<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { INVOICE_KINDS, type FinanceMoveType } from './invoiceKinds'
import {
  buildInvoiceCreate,
  buildInvoicePatch,
  emptyInvoiceDraft,
  hasInvoiceErrors,
  invoiceDraftDirty,
  offersAssetProfile,
  lineSubtotal,
  newLine,
  validateInvoiceDraft,
  type InvoiceFormDraft,
} from './invoiceLines'
import { formatAmount } from './formatAmount'
import PartnerPicker from './PartnerPicker.vue'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from './invoiceErrors'
import { useCreateFinanceInvoice, usePatchFinanceInvoice } from '@/composables/finance/useFinanceInvoices'
import { useSetupPaymentTerms } from '@/composables/finance/useFinanceRecords'
import { useFinanceAssetProfiles } from '@/composables/finance/useFinanceAssets'

// The editor of a document: the create panel (a new draft) and the record page's edit mode (the draft's header and
// lines; the lines sent replace the draft's lines). Numbers stay as typed until validated; taxes follow the account's
// defaults unless a line says "no tax".
const props = defineProps<{
  moveType: FinanceMoveType
  backTo: RouteLocationRaw
  /** The draft being edited; omitted when a new document is created. */
  recordId?: number
  initial?: InvoiceFormDraft
  knownPartner?: { id: number; name: string } | null
}>()
const emit = defineEmits<{ saved: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const kind = computed(() => INVOICE_KINDS[props.moveType])
const create = useCreateFinanceInvoice()
const patch = usePatchFinanceInvoice()
const pending = computed(() => create.isPending.value || patch.isPending.value)

const { can } = useAccess()
const terms = useSetupPaymentTerms({ archived: 'false', limit: 100, offset: 0 }, () => can('finance.payment_terms.read'))
const NO_TERM = 'none'
const termItems = computed(() => [
  { value: NO_TERM, label: t('financeDocuments.form.noPaymentTerm') },
  ...(terms.data.value?.items ?? []).map(term => ({ value: String(term.id), label: term.name })),
])
// A chosen term derives the due date on the server unless a date is typed too, so picking one clears the typed date.
function pickTerm(value: unknown) {
  draft.paymentTermId = value === NO_TERM ? null : Number(value)
  if (draft.paymentTermId) draft.invoiceDateDue = null
}

// A vendor-bill line may capitalise into an asset: the select is for fixed-asset managers, who may also read the profiles.
const showAssetProfile = computed(() => offersAssetProfile(props.moveType, can('finance.assets.manage')))
const profiles = useFinanceAssetProfiles(showAssetProfile)
const NO_PROFILE = 'none'
const profileItems = computed(() => [
  { value: NO_PROFILE, label: t('financeDocuments.form.noAssetProfile') },
  ...(profiles.data.value?.items ?? []).map(profile => ({ value: String(profile.id), label: profile.name })),
])
function pickProfile(line: InvoiceFormDraft['lines'][number], value: unknown) {
  line.assetProfileId = value === NO_PROFILE ? null : Number(value)
}

const baseline = props.initial ?? emptyInvoiceDraft()
const draft = reactive<InvoiceFormDraft>(structuredClone(toRaw(baseline)))
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const dirty = computed(() => !saved.value && invoiceDraftDirty(draft, baseline))
const errors = computed(() => validateInvoiceDraft(draft))
const shown = computed(() => attempted.value ? errors.value : null)
const subtotal = computed(() => draft.lines.reduce((sum, line) => sum + lineSubtotal(line), 0))

function addLine() { draft.lines.push(newLine()) }
function removeLine(index: number) { if (draft.lines.length > 1) draft.lines.splice(index, 1) }

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (hasInvoiceErrors(errors.value)) return
  try {
    const record = props.recordId
      ? await patch.mutateAsync({ id: props.recordId, body: buildInvoicePatch(draft) })
      : await create.mutateAsync(buildInvoiceCreate(props.moveType, draft))
    saved.value = true
    await nextTick()
    emit('saved', record.id)
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="draft" class="liwan-form" method="post" data-testid="finance-invoice-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-invoice-form-error" />
    <SharedFormSection panel :title="t('financeDocuments.form.details')">
      <div class="grid gap-4">
        <UFormField :label="t(`financeDocuments.kinds.${moveType}.partner`)" name="finance-invoice-partner" required :error="shown?.partner ? t('financeDocuments.form.partnerRequired') : undefined">
          <PartnerPicker
            id="finance-invoice-partner"
            v-model="draft.partnerId"
            :kind="kind.partnerKind"
            :known="knownPartner"
            :disabled="pending"
            :invalid="!!shown?.partner"
            :placeholder="t(`financeDocuments.kinds.${moveType}.partnerPlaceholder`)"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField :label="t('financeDocuments.form.invoiceDate')" name="finance-invoice-date">
            <SharedDateField id="finance-invoice-date" v-model="draft.invoiceDate" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField v-if="can('finance.payment_terms.read')" :label="t('financeDocuments.form.paymentTerm')" name="finance-invoice-term">
            <USelect id="finance-invoice-term" class="w-full" :model-value="draft.paymentTermId ? String(draft.paymentTermId) : NO_TERM" :items="termItems" :disabled="!hydrated || pending" @update:model-value="pickTerm" />
          </UFormField>
          <UFormField :label="t('financeDocuments.form.dueDate')" name="finance-invoice-due" :error="shown?.dueBeforeDate ? t('financeDocuments.form.dueBeforeDate') : undefined">
            <SharedDateField id="finance-invoice-due" v-model="draft.invoiceDateDue" :min-value="draft.invoiceDate" :disabled="!hydrated || pending || !!draft.paymentTermId" />
          </UFormField>
        </div>
        <UFormField :label="t('financeDocuments.form.ref')" name="finance-invoice-ref">
          <UInput id="finance-invoice-ref" v-model="draft.ref" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('financeDocuments.form.lines')" :description="t('financeDocuments.form.linesHint')">
      <ol class="grid gap-4" data-testid="finance-invoice-lines">
        <li v-for="(line, index) in draft.lines" :key="line.key" class="grid gap-3 rounded-card bg-elevated p-3 md:grid-cols-[minmax(0,1fr)_6rem_8rem_6rem] md:items-start" :data-testid="`finance-invoice-line-${index}`">
          <UFormField :label="t('financeDocuments.form.lineName')" :name="`finance-line-name-${index}`" required :error="shown?.lines[index]?.name ? t('financeDocuments.form.lineNameRequired') : undefined" class="md:col-span-1">
            <UInput v-model="line.name" class="w-full" maxlength="255" :disabled="!hydrated || pending" :aria-label="t('financeDocuments.form.lineAria', { number: index + 1, field: t('financeDocuments.form.lineName') })" />
          </UFormField>
          <UFormField :label="t('financeDocuments.form.quantity')" :name="`finance-line-quantity-${index}`" :error="shown?.lines[index]?.quantity ? t('financeDocuments.form.quantityInvalid') : undefined">
            <UInput v-model="line.quantity" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" :aria-label="t('financeDocuments.form.lineAria', { number: index + 1, field: t('financeDocuments.form.quantity') })" />
          </UFormField>
          <UFormField :label="t('financeDocuments.form.unitPrice')" :name="`finance-line-price-${index}`" :error="shown?.lines[index]?.priceUnit ? t('financeDocuments.form.priceInvalid') : undefined">
            <UInput v-model="line.priceUnit" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" :aria-label="t('financeDocuments.form.lineAria', { number: index + 1, field: t('financeDocuments.form.unitPrice') })" />
          </UFormField>
          <UFormField :label="t('financeDocuments.form.discount')" :name="`finance-line-discount-${index}`" :error="shown?.lines[index]?.discount ? t('financeDocuments.form.discountInvalid') : undefined">
            <UInput v-model="line.discount" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" :aria-label="t('financeDocuments.form.lineAria', { number: index + 1, field: t('financeDocuments.form.discount') })" />
          </UFormField>
          <UFormField v-if="showAssetProfile" class="md:col-span-4" :label="t('financeDocuments.form.assetProfile')" :name="`finance-line-asset-profile-${index}`" :description="t('financeDocuments.form.assetProfileHint')">
            <USelect :model-value="line.assetProfileId ? String(line.assetProfileId) : NO_PROFILE" :items="profileItems" class="w-full" :loading="profiles.isLoading.value" :disabled="!hydrated || pending" :aria-label="t('financeDocuments.form.lineAria', { number: index + 1, field: t('financeDocuments.form.assetProfile') })" :data-testid="`finance-line-asset-profile-${index}`" @update:model-value="value => pickProfile(line, value)" />
          </UFormField>
          <div class="flex flex-wrap items-center justify-between gap-3 md:col-span-4">
            <USwitch v-model="line.noTax" :label="t('financeDocuments.form.noTax')" :disabled="!hydrated || pending" />
            <div class="flex items-center gap-3">
              <span class="text-sm text-muted">{{ t('financeDocuments.form.lineSubtotal') }} <span class="font-semibold text-highlighted tabular-nums"><bdi>{{ formatAmount(lineSubtotal(line)) }}</bdi></span></span>
              <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :disabled="!hydrated || pending || draft.lines.length === 1" :aria-label="t('financeDocuments.form.removeLine', { number: index + 1 })" @click="removeLine(index)" />
            </div>
          </div>
        </li>
      </ol>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated || pending" :label="t('financeDocuments.form.addLine')" data-testid="finance-invoice-add-line" @click="addLine" />
        <p class="text-sm text-muted">{{ t('financeDocuments.form.subtotal') }} <span class="font-semibold text-highlighted tabular-nums"><bdi>{{ formatAmount(subtotal) }}</bdi></span> · {{ t('financeDocuments.form.taxAtSave') }}</p>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeDocuments.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton v-if="recordId" type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton v-else type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="recordId ? t('app.save') : t('financeDocuments.form.createDraft')" data-testid="finance-invoice-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
