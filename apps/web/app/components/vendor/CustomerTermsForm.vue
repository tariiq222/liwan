<script setup lang="ts">
import { commercialErrorKey, commercialFailure, fieldIssue, keyLabel, limitFromDraft, parseCount, parseVendorMoneyInput } from '@/utils/vendorCommercial'
import { emptyTermsDraft, hasTermsOverride, type TermsDraft } from '@/utils/vendorSubscriptions'
const props = withDefaults(defineProps<{ busy?: boolean; previewing?: boolean; error?: unknown; resetKey?: number; canSave?: boolean; canPreview?: boolean }>(), { busy: false, previewing: false, resetKey: 0, canSave: true, canPreview: true })
const emit = defineEmits<{ preview: [draft: TermsDraft]; save: [draft: TermsDraft]; cancel: [] }>()
const { t, te } = useI18n(); const hydrated = useHydrated()
const draft = reactive<TermsDraft>(emptyTermsDraft())
const serialized = () => JSON.stringify(draft)
const baseline = ref(serialized()); const attempted = ref(false)
const dirty = computed(() => serialized() !== baseline.value)
watch(() => props.resetKey, () => { baseline.value = serialized(); attempted.value = false })
const failure = computed(() => (props.error ? commercialFailure(props.error) : null))
const serverIssue = (field: string) => { const code = fieldIssue(failure.value, field); return code ? t(commercialErrorKey({ code })) : undefined }
const dis = computed(() => !hydrated.value || props.busy)
const unitItems = computed(() => [{ label: t('vendor.pricing.cadence.month.one'), value: 'month' }, { label: t('vendor.pricing.cadence.year.one'), value: 'year' }])
const limitItems = computed(() => [{ label: t('vendor.pricing.limit.unlimited'), value: 'unlimited' }, { label: t('vendor.pricing.limit.none'), value: 'none' }, { label: t('vendor.pricing.limit.number'), value: 'number' }])
const limitError = (l: TermsDraft['users']) => { if (!l.mode) return undefined; try { limitFromDraft(l); return undefined } catch { return t('vendor.pricing.limit.invalid') } }
const errors = computed(() => {
  const e: Record<string, string> = {}
  const bad = t('vendor.customers.terms.invalidValue')
  if (draft.basePrice.trim() && (parseVendorMoneyInput(draft.basePrice) === null || !draft.baseUnit || (parseCount(draft.baseCount, 12) ?? 0) < 1)) e.base = bad
  if (draft.includedExtraBranches.trim() && parseCount(draft.includedExtraBranches) === null) e.free = bad
  if (draft.extraBranchPrice.trim() && (parseVendorMoneyInput(draft.extraBranchPrice) === null || !draft.extraBranchUnit || (parseCount(draft.extraBranchCount, 12) ?? 0) < 1)) e.branchPrice = bad
  for (const [k, l] of [['branchLimit', draft.extraBranchesLimit], ['users', draft.users], ['storage', draft.storage]] as const) { const x = limitError(l); if (x) e[k] = x }
  if (draft.termMonths.trim() && (parseCount(draft.termMonths, 120) ?? 0) < 1) e.term = bad
  if (draft.reason.trim().length < 3) e.reason = t('vendor.pricing.reasonRequired')
  return e
})
const previewErrors = computed(() => { const { reason: _r, ...rest } = errors.value; return rest })
const overridden = computed(() => hasTermsOverride({ ...draft, reason: 'xxx' }))
const show = (k: string) => (attempted.value ? errors.value[k] : undefined)
function preview() {
  attempted.value = true
  if (!hydrated.value || props.previewing || Object.keys(previewErrors.value).length || !overridden.value) return
  emit('preview', draft)
}
function submit() {
  attempted.value = true
  if (!hydrated.value || props.busy || !props.canSave || Object.keys(errors.value).length || !overridden.value) return
  emit('save', draft)
}
defineExpose({ draft })
</script>
<template>
  <form class="space-y-6" novalidate data-slot="customer-terms-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <UAlert color="info" variant="subtle" icon="i-lucide-shield-check" :title="t('vendor.customers.terms.isolation')" :description="t('vendor.customers.terms.isolationHint')" />
    <p class="text-sm text-muted">{{ t('vendor.customers.terms.blankHint') }}</p>
    <SharedFormSection :title="t('vendor.customers.terms.pricing')">
      <div class="grid gap-4 sm:grid-cols-3">
        <UFormField :label="t('vendor.customers.terms.basePrice')" :error="show('base') || serverIssue('base_price')"><UInput v-model="draft.basePrice" dir="ltr" inputmode="decimal" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.cadence')"><USelect v-model="draft.baseUnit" :items="unitItems" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.customers.terms.count')"><UInput v-model="draft.baseCount" dir="ltr" inputmode="numeric" class="w-full" :disabled="dis" /></UFormField>
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <UFormField :label="t('vendor.customers.terms.extraBranchPrice')" :error="show('branchPrice') || serverIssue('extra_branch_price')"><UInput v-model="draft.extraBranchPrice" dir="ltr" inputmode="decimal" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.cadence')"><USelect v-model="draft.extraBranchUnit" :items="unitItems" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.customers.terms.count')"><UInput v-model="draft.extraBranchCount" dir="ltr" inputmode="numeric" class="w-full" :disabled="dis" /></UFormField>
      </div>
      <UFormField :label="t('vendor.customers.terms.includedBranches')" :error="show('free') || serverIssue('included_extra_branches')"><UInput v-model="draft.includedExtraBranches" dir="ltr" inputmode="numeric" class="w-full sm:w-48" :disabled="dis" /></UFormField>
      <UFormField :label="t('vendor.customers.terms.termMonths')" :error="show('term') || serverIssue('term_months')"><UInput v-model="draft.termMonths" dir="ltr" inputmode="numeric" class="w-full sm:w-48" :disabled="dis" /></UFormField>
    </SharedFormSection>
    <SharedFormSection :title="t('vendor.customers.terms.limits')">
      <div v-for="row in [{ k: 'users', label: keyLabel('users.limit', t, te), l: draft.users }, { k: 'storage', label: keyLabel('storage.limit_mb', t, te), l: draft.storage }, { k: 'branchLimit', label: t('vendor.customers.terms.extraBranchesLimit'), l: draft.extraBranchesLimit }]" :key="row.k" class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="row.label" :error="show(row.k)"><USelect v-model="row.l.mode" :items="limitItems" :placeholder="t('vendor.customers.terms.inherit')" class="w-full" :disabled="dis" /></UFormField>
        <UFormField v-if="row.l.mode === 'number'" :label="t('vendor.pricing.limit.number')"><UInput v-model="row.l.value" dir="ltr" inputmode="numeric" class="w-full" :disabled="dis" /></UFormField>
      </div>
    </SharedFormSection>
    <UFormField :label="t('vendor.pricing.fields.reason')" required :error="show('reason') || serverIssue('reason')"><UTextarea v-model="draft.reason" maxlength="1000" class="w-full" :disabled="dis" /></UFormField>
    <UAlert v-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(error))" />
    <p v-if="attempted && !overridden" class="text-sm text-error">{{ t('vendor.customers.terms.nothing') }}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton color="neutral" variant="ghost" :disabled="busy" @click="emit('cancel')">{{ t('vendor.customers.cancel') }}</UButton>
      <UButton color="neutral" variant="outline" :loading="previewing" :disabled="dis || previewing || !canPreview" @click="preview">{{ t('vendor.customers.terms.preview') }}</UButton>
      <UButton type="submit" :loading="busy" :disabled="dis || !canSave">{{ t('vendor.customers.terms.save') }}</UButton>
    </div>
  </form>
</template>
