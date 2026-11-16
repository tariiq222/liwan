<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { SALES_TEMPLATE_LIMITS, type SalesTemplate } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { salesRefusalKey, salesTemplateFormField, type SalesTemplateField } from '@/composables/sales/salesErrors'
import { emptySalesTemplateDraft, hasSalesTemplateDraftErrors, salesTemplateBody, salesTemplateDraftFromTemplate, salesTemplateDraftSnapshot, validateSalesTemplateDraft, type SalesTemplateDraft, type SalesTemplateDraftErrors } from '@/composables/sales/salesTemplateDraft'
import { useCreateSalesTemplate, useUpdateSalesTemplate } from '@/composables/sales/useSalesTemplates'
import SalesLinesEditor from './SalesLinesEditor.vue'

// The create form of the route-backed panel and the edit page of a quotation template: its name, how many days a quotation
// started from it stays valid (0 keeps the tenant's setting), its terms and its lines. The lines carry a product and a
// quantity, never a price: a quotation prices them when it starts. A refusal on a field is shown at that field, any
// other at the top.
const props = defineProps<{ template?: SalesTemplate | null; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [template: SalesTemplate] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const draft = ref<SalesTemplateDraft>(emptySalesTemplateDraft())
const savedState = ref('')
const dirty = computed(() => savedState.value !== salesTemplateDraftSnapshot(draft.value))
// A refetch hands the form the same template again: it must not wipe what the user typed.
let initialised = false
watch(() => props.template, (template, previous) => {
  if (initialised && previous?.id === template?.id && dirty.value) return
  initialised = true
  draft.value = template ? salesTemplateDraftFromTemplate(template) : emptySalesTemplateDraft()
  savedState.value = salesTemplateDraftSnapshot(draft.value)
}, { immediate: true })

const checked = ref<SalesTemplateDraftErrors | null>(null)
const errors = computed<SalesTemplateDraftErrors>(() => checked.value ? validateSalesTemplateDraft(draft.value) : { name: false, validityDays: false, noLines: false, lines: [] })
const formError = ref<unknown>(null)
watch(draft, () => { formError.value = null }, { deep: true })
const refusedField = computed(() => salesTemplateFormField(formError.value))
const refusalMessage = computed(() => {
  if (!formError.value) return ''
  const key = salesRefusalKey(formError.value)
  return key ? t(key) : saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain'))
})
const refusedLine = computed(() => refusedField.value?.kind === 'line' && refusedField.value.index < draft.value.lines.length
  ? { index: refusedField.value.index, field: refusedField.value.field, message: refusalMessage.value }
  : null)
const headerError = (field: SalesTemplateField) => refusedField.value?.kind === 'template' && refusedField.value.field === field ? refusalMessage.value : undefined
const alertVisible = computed(() => !!formError.value && !refusedField.value)

const { mutateAsync: create, isPending: creating } = useCreateSalesTemplate()
const { mutateAsync: update, isPending: updating } = useUpdateSalesTemplate()
const pending = computed(() => creating.value || updating.value)
const off = computed(() => !hydrated.value || pending.value)

let submitting = false
async function submit() {
  if (off.value || submitting) return
  checked.value = validateSalesTemplateDraft(draft.value)
  if (hasSalesTemplateDraftErrors(checked.value)) return
  submitting = true
  formError.value = null
  try {
    const body = salesTemplateBody(draft.value)
    const saved = props.template ? await update({ id: props.template.id, patch: body }) : await create(body)
    savedState.value = salesTemplateDraftSnapshot(draft.value)
    emit('saved', saved)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="draft" class="liwan-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="alertVisible" role="alert" color="error" variant="subtle" :title="t('sales.templates.form.saveError')" :description="refusalMessage" data-testid="sales-template-error" />
    <SharedFormSection panel :title="t('sales.templates.form.header')" :description="t('sales.templates.form.headerHint')">
      <div class="liwan-auto-grid liwan-field-grid">
        <UFormField class="liwan-span-full" :label="t('sales.templates.form.name')" name="sales-template-name" required :error="errors.name ? t('sales.templates.form.nameRequired') : headerError('name')">
          <UInput v-model="draft.name" class="w-full" :maxlength="SALES_TEMPLATE_LIMITS.name" :disabled="off" data-testid="sales-template-name" />
        </UFormField>
        <UFormField :label="t('sales.templates.form.validityDays')" name="sales-template-validity" :help="t('sales.templates.form.validityDaysHint')" :error="errors.validityDays ? t('sales.templates.form.validityDaysInvalid') : headerError('validity_days')">
          <UInputNumber v-model="draft.validityDays" class="w-full" :min="0" :max="SALES_TEMPLATE_LIMITS.validityDays" :step="1" :disabled="off" data-testid="sales-template-validity" />
        </UFormField>
        <UFormField class="liwan-span-full" :label="t('sales.templates.form.terms')" name="sales-template-terms" :help="t('sales.templates.form.termsHint')" :error="headerError('terms')">
          <UTextarea v-model="draft.terms" class="w-full" :rows="3" autoresize :maxlength="SALES_TEMPLATE_LIMITS.terms" :disabled="off" data-testid="sales-template-terms" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('sales.templates.form.lines')" :description="t('sales.templates.form.linesHint')">
      <p v-if="errors.noLines" role="alert" class="text-sm text-error">{{ t('sales.lines.errors.none') }}</p>
      <SalesLinesEditor v-model="draft.lines" :errors="errors.lines" :refused="refusedLine" :disabled="off" :priced="false" />
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="off" :loading="pending" :label="t(props.template ? 'app.saveChanges' : 'sales.templates.form.create')" data-testid="sales-template-submit" />
    </SharedFormActions>
  </UForm>
</template>
