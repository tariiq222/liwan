<script setup lang="ts">
import { AI_LIMIT_KEYS, COMMERCIAL_MAX_USERS, commercialErrorKey, commercialFailure, emptyPlanDraft, fieldIssue, limitFromDraft, MAX_STORAGE_STEP_MB, MB_PER_GB, parseCount, planDraftFromView, priceRowErrors, storageStepsAligned, type BundleView, type PlanDraft, type PlanView } from '@/utils/vendorCommercial'
import { defaultPolicyId, policyOptions } from './policySelection'
import type { PricingPolicyView } from '@/composables/useVendorCommercial'
// `policy` is the policy a saved plan keeps; the form only prefills it with an edit and lets the vendor choose any approved policy.
const props = withDefaults(defineProps<{ bundles: BundleView[]; policies?: PricingPolicyView[]; policy?: PricingPolicyView; initial?: PlanView; busy?: boolean; error?: unknown; resetKey?: number; requireReason?: boolean }>(), { busy: false, resetKey: 0, requireReason: false })
const emit = defineEmits<{ save: [draft: PlanDraft]; cancel: [] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const policyList = computed<PricingPolicyView[]>(() => (props.policies?.length ? props.policies : props.policy ? [props.policy] : []))
function initialPolicyId(): string {
  if (props.initial) return policyList.value.some(p => p.id === props.initial!.policy_revision_id) ? props.initial.policy_revision_id : ''
  return defaultPolicyId(policyList.value) ?? ''
}
const draft = reactive<PlanDraft>({ ...(props.initial ? planDraftFromView(props.initial) : emptyPlanDraft()), policy_revision_id: initialPolicyId() })
// The pricing policy is a selector, not a value typed into the form, so choosing it never counts as an unsaved edit.
const editable = () => JSON.stringify({ ...draft, policy_revision_id: '' })
const baseline = ref(editable()); const attempted = ref(false)
const dirty = computed(() => editable() !== baseline.value)
watch(() => props.resetKey, () => { baseline.value = editable(); attempted.value = false })
const failure = computed(() => (props.error ? commercialFailure(props.error) : null))
const serverIssue = (field: string) => { const code = fieldIssue(failure.value, field); return code ? t(commercialErrorKey({ code })) : undefined }
const dis = computed(() => !hydrated.value || props.busy)
const choiceItems = computed(() => [{ label: t('vendor.common.yes'), value: 'true' }, { label: t('vendor.common.no'), value: 'false' }])
const audienceItems = computed(() => [{ label: t('vendor.pricing.audience.public'), value: 'public' }, { label: t('vendor.pricing.audience.customer'), value: 'customer' }])
const bundleName = (b: BundleView) => `${b.name} · v${b.version}`
// A bundle may be included or optional, never both; the audience of a plan must be compatible with its bundles.
function setBundle(list: 'included' | 'optional', id: string, on: boolean) {
  const other = list === 'included' ? 'optional' : 'included'
  draft[list] = on ? [...new Set([...draft[list], id])] : draft[list].filter(x => x !== id)
  if (on) draft[other] = draft[other].filter(x => x !== id)
}
const releaseIds = computed(() => new Set(props.bundles.filter(b => [...draft.included, ...draft.optional].includes(b.id)).map(b => b.catalog_release_id)))
const offeredCadences = computed(() => draft.prices.filter(row => row.unit).map(row => `${row.unit}:${row.count}`))
const pricedCadences = (rows: typeof draft.user_prices) => new Set(rows.filter(row => row.unit).map(row => `${row.unit}:${row.count}`))
const unitPriceMissing = computed(() => {
  const users = pricedCadences(draft.user_prices), storage = pricedCadences(draft.storage_prices)
  return offeredCadences.value.length > 0 && offeredCadences.value.some(key => !users.has(key) || !storage.has(key))
})
const errors = computed(() => {
  const e: Record<string, string> = {}
  const req = t('vendor.pricing.required')
  if (!draft.name.trim()) e.name = req
  if (draft.audience.kind === 'customer' && !draft.audience.customer_id.trim()) e.audience = req
  const term = parseCount(draft.term_months, 120); if (term === null || term < 1) e.term = req
  if (!draft.prices.length || priceRowErrors(draft.prices).some(Boolean)) e.prices = t('vendor.pricing.prices.invalid')
  if (!draft.included.length && !draft.optional.length) e.bundles = t('vendor.pricing.plan.bundlesRequired')
  if (releaseIds.value.size > 1) e.bundles = t('vendor.pricing.plan.singleRelease')
  // Release 1 sells at most COMMERCIAL_MAX_USERS users; the cap is refused here, before any request is sent.
  // Parsed without the cap: a value above it must say so, not read as "required" (the cap used to swallow the number).
  const includedUserCount = parseCount(draft.included_users)
  if (includedUserCount === null) e.includedUsers = t('vendor.pricing.plan.usersRequired')
  else if (includedUserCount > COMMERCIAL_MAX_USERS) e.includedUsers = t('vendor.pricing.plan.usersCapExceeded')
  const storage = parseCount(draft.included_storage_mb)
  if (storage === null) e.includedStorage = req
  else if (storage % MB_PER_GB !== 0) e.includedStorage = t('vendor.pricing.plan.storageMinimumGb')
  // A6: the three storage steps are vendor-editable plan values, bounded where they are parsed and required to tile
  // the range they govern (the same rule the contract and the database CHECK enforce).
  for (const field of ['storage_step_mb', 'storage_step_threshold_mb', 'storage_large_step_mb'] as const) {
    const step = parseCount(draft[field])
    if (step === null) e[field] = req
    else if (step > MAX_STORAGE_STEP_MB) e[field] = t('vendor.pricing.plan.storageStepTooLarge')
  }
  if (!e.storage_step_mb && !e.storage_step_threshold_mb && !e.storage_large_step_mb
    && !storageStepsAligned({ storage_step_mb: Number(draft.storage_step_mb), storage_step_threshold_mb: Number(draft.storage_step_threshold_mb), storage_large_step_mb: Number(draft.storage_large_step_mb) }))
    e.storage_step_threshold_mb = t('vendor.pricing.plan.storageStepMisaligned')
  if (priceRowErrors(draft.user_prices).some(Boolean)) e.userPrices = t('vendor.pricing.prices.invalid')
  if (priceRowErrors(draft.storage_prices).some(Boolean)) e.storagePrices = t('vendor.pricing.prices.invalid')
  if (unitPriceMissing.value) e.unitPrices = t('vendor.pricing.prices.cadenceMissing')
  if (parseCount(draft.included_extra_branches) === null) e.free = req
  if (priceRowErrors(draft.extra_branch_prices).some(Boolean)) e.branchPrices = t('vendor.pricing.prices.invalid')
  try { limitFromDraft(draft.extra_branches_limit) } catch { e.branchLimit = t('vendor.pricing.limit.required') }
  // The AI budget is a non-negative integer or unlimited; an unreadable value stops the save with a clear message.
  for (const key of AI_LIMIT_KEYS) {
    const limit = draft.ai_limits[key]
    if (limit?.mode === 'number' && !/^\d+$/.test(String(limit.value).trim())) e[`ai_${key}`] = t('vendor.pricing.plan.aiLimitInvalid')
  }
  if (parseCount(draft.trial_days, 3650) === null) e.trial = req
  if (parseCount(draft.grace_days, 3650) === null) e.grace = req
  if (!draft.auto_suspend) e.suspend = req
  if (!draft.auto_renew_allowed) e.renew = req
  if (!draft.policy_revision_id) e.policy = t('vendor.pricing.plan.policyRequired')
  if (props.requireReason && draft.reason.trim().length < 3) e.reason = t('vendor.pricing.reasonRequired')
  return e
})
function submit() {
  if (!hydrated.value || props.busy) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  emit('save', draft)
}
const show = (k: string) => (attempted.value ? errors.value[k] : undefined)
// The approved policy the vendor chose (never the first listed row); VAT wording appears only after an explicit VAT choice.
const policy = computed(() => policyList.value.find(p => p.id === draft.policy_revision_id))
const policyTaxText = (policy: PricingPolicyView) => (policy.tax.kind === 'vat_exclusive' ? t('vendor.pricing.plan.vat', { rate: policy.tax.rate_bps / 100 }) : t('vendor.pricing.plan.noTax'))
const policyItems = computed(() => policyOptions(policyList.value, policyTaxText))
const taxText = computed<string | null>(() => (policy.value ? policyTaxText(policy.value) : null))
</script>
<template>
  <form class="space-y-6" novalidate data-testid="plan-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <UAlert v-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(error))" :description="failure.field ? t('vendor.pricing.errors.atField', { field: failure.field }) : undefined" />
    <SharedFormSection panel :title="t('vendor.pricing.sections.basics')">
      <div class="space-y-4">
        <UFormField :label="t('vendor.pricing.fields.name')" required :error="show('name') ?? serverIssue('name')"><UInput v-model="draft.name" maxlength="200" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.audience')" required :error="show('audience') ?? serverIssue('audience')">
          <div class="flex gap-2"><USelect v-model="draft.audience.kind" :items="audienceItems" :disabled="dis" :aria-label="t('vendor.pricing.fields.audience')" :class="draft.audience.kind === 'customer' ? 'w-40 shrink-0' : 'w-full'" /><UInput v-if="draft.audience.kind === 'customer'" v-model="draft.audience.customer_id" dir="ltr" class="min-w-0 flex-1" :placeholder="t('vendor.pricing.audience.customerId')" :aria-label="t('vendor.pricing.audience.customerId')" :disabled="dis" /></div>
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('vendor.pricing.fields.currency')"><UInput :model-value="t('vendor.pricing.currencyFixed')" readonly class="w-full" /></UFormField>
          <UFormField :label="t('vendor.pricing.fields.termMonths')" required :error="show('term') ?? serverIssue('term_months')"><UInput v-model="draft.term_months" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
        </div>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('vendor.pricing.sections.pricesAndBundles')">
      <div class="space-y-6">
        <VendorPriceListEditor v-model="draft.prices" :label="t('vendor.pricing.sections.basePrices')" :hint="t('vendor.pricing.plan.basePricesHint')" :disabled="dis" :show-errors="attempted" :server-error="serverIssue('prices')" />
        <VendorPriceListEditor v-model="draft.user_prices" :label="t('vendor.pricing.fields.userPrice')" :hint="t('vendor.pricing.plan.userPricesHint')" :disabled="dis" :show-errors="attempted" :server-error="serverIssue('user_prices')" />
        <VendorPriceListEditor v-model="draft.storage_prices" :label="t('vendor.pricing.fields.storagePrice')" :hint="t('vendor.pricing.plan.storagePricesHint')" :disabled="dis" :show-errors="attempted" :server-error="serverIssue('storage_prices')" />
        <p v-if="attempted && errors.unitPrices" class="text-sm text-error">{{ errors.unitPrices }}</p>
        <VendorFormSubsection :title="t('vendor.pricing.sections.bundles')" :description="t('vendor.pricing.plan.bundlesHint')">
          <SharedEmptyState v-if="!bundles.length" :title="t('vendor.pricing.plan.noBundles')" />
          <p v-if="show('bundles') ?? serverIssue('included_bundle_revision_ids')" class="text-sm text-error">{{ show('bundles') ?? serverIssue('included_bundle_revision_ids') }}</p>
          <div v-for="b in bundles" :key="b.id" class="flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 ring ring-default">
            <span class="font-medium">{{ bundleName(b) }}</span>
            <span class="flex flex-wrap gap-4">
              <UCheckbox :model-value="draft.included.includes(b.id)" :label="t('vendor.pricing.plan.included')" :disabled="dis" @update:model-value="setBundle('included', b.id, $event === true)" />
              <UCheckbox :model-value="draft.optional.includes(b.id)" :label="t('vendor.pricing.plan.optional')" :disabled="dis" @update:model-value="setBundle('optional', b.id, $event === true)" />
            </span>
          </div>
        </VendorFormSubsection>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('vendor.pricing.sections.quantities')" :description="t('vendor.pricing.plan.quantitiesHint')">
      <div class="space-y-6">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('vendor.pricing.fields.includedUsers')" required :error="show('includedUsers') ?? serverIssue('included_users')"><UInput v-model="draft.included_users" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
          <p class="text-sm text-muted">{{ t('vendor.pricing.plan.usersCapNote') }}</p>
          <UFormField :label="t('vendor.pricing.fields.includedStorage')" required :error="show('includedStorage') ?? serverIssue('included_storage_mb')"><UInput v-model="draft.included_storage_mb" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
          <UFormField :label="t('vendor.pricing.fields.storageStep')" required :help="t('vendor.pricing.fields.storageStepHint')" :error="show('storage_step_mb') ?? serverIssue('storage_step_mb')"><UInput v-model="draft.storage_step_mb" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
          <UFormField :label="t('vendor.pricing.fields.storageStepThreshold')" required :help="t('vendor.pricing.fields.storageStepThresholdHint')" :error="show('storage_step_threshold_mb') ?? serverIssue('storage_step_threshold_mb')"><UInput v-model="draft.storage_step_threshold_mb" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
          <UFormField :label="t('vendor.pricing.fields.storageLargeStep')" required :help="t('vendor.pricing.fields.storageLargeStepHint')" :error="show('storage_large_step_mb') ?? serverIssue('storage_large_step_mb')"><UInput v-model="draft.storage_large_step_mb" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
          <UFormField :label="t('vendor.pricing.fields.freeBranches')" required :error="show('free') ?? serverIssue('included_extra_branches')"><UInput v-model="draft.included_extra_branches" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
          <UFormField :label="t('vendor.pricing.fields.branchLimit')" required :error="show('branchLimit') ?? serverIssue('extra_branches_limit')"><VendorLimitControl v-model="draft.extra_branches_limit" :label="t('vendor.pricing.fields.branchLimit')" :disabled="dis" /></UFormField>
        </div>
        <p class="rounded-lg bg-elevated p-3 text-sm">{{ t('vendor.pricing.plan.hq') }}</p>
        <VendorPriceListEditor v-model="draft.extra_branch_prices" :label="t('vendor.pricing.fields.branchPrice')" :disabled="dis" :show-errors="attempted" :server-error="serverIssue('extra_branch_prices')" />
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('vendor.pricing.sections.ai')" :description="t('vendor.pricing.plan.aiHint')">
      <div class="grid items-start gap-4 sm:grid-cols-2">
        <UFormField v-for="key in AI_LIMIT_KEYS" :key="key" :label="t(`vendor.pricing.plan.aiLimits.${key.replaceAll('.', '_')}`)" :help="t('vendor.pricing.plan.aiUnlimitedHint')" :error="show(`ai_${key}`)">
          <VendorLimitControl v-model="draft.ai_limits[key]" :label="t(`vendor.pricing.plan.aiLimits.${key.replaceAll('.', '_')}`)" :none-allowed="false" :disabled="dis" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('vendor.pricing.sections.lifecycle')" :description="t('vendor.pricing.plan.lifecycleHint')">
      <div class="grid items-start gap-4 sm:grid-cols-2">
        <UFormField :label="t('vendor.pricing.fields.trialDays')" required :error="show('trial') ?? serverIssue('trial_days')"><UInput v-model="draft.trial_days" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.graceDays')" required :error="show('grace') ?? serverIssue('grace_days')"><UInput v-model="draft.grace_days" inputmode="numeric" dir="ltr" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.autoSuspend')" required :error="show('suspend') ?? serverIssue('auto_suspend')"><USelect v-model="draft.auto_suspend" :items="choiceItems" :placeholder="t('vendor.pricing.choose')" class="w-full" :disabled="dis" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.autoRenew')" required :help="t('vendor.pricing.plan.autoRenewHint')" :error="show('renew') ?? serverIssue('auto_renew_allowed')"><USelect v-model="draft.auto_renew_allowed" :items="choiceItems" :placeholder="t('vendor.pricing.choose')" class="w-full" :disabled="dis" /></UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('vendor.pricing.sections.review')" :description="t('vendor.pricing.plan.reviewHint')">
      <div class="space-y-4">
        <dl class="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt class="text-muted">{{ t('vendor.pricing.policy.timezone') }}</dt><dd>{{ policy?.timezone ?? '—' }}</dd></div>
          <div><dt class="text-muted">{{ t('vendor.pricing.policy.tax') }}</dt><dd>{{ taxText ?? '—' }}</dd></div>
        </dl>
        <UAlert v-if="!policyList.length" color="warning" variant="subtle" :title="t('vendor.pricing.plan.policyMissing')" />
        <UFormField :label="t('vendor.pricing.policy.select')" required :help="t('vendor.pricing.policy.selectHint')" :error="show('policy') ?? serverIssue('policy_revision_id')">
          <USelect v-model="draft.policy_revision_id" :items="policyItems" :placeholder="t('vendor.pricing.policy.none')" class="w-full" :disabled="dis" data-testid="plan-policy" />
        </UFormField>
        <UFormField v-if="requireReason" :label="t('vendor.pricing.fields.reason')" required :error="show('reason') ?? serverIssue('reason')"><UTextarea v-model="draft.reason" maxlength="1000" class="w-full" :disabled="dis" /></UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="submit" :loading="busy" :disabled="dis">{{ t('vendor.pricing.saveDraft') }}</UButton>
      <UButton color="neutral" variant="outline" :disabled="dis" @click="emit('cancel')">{{ t('app.cancel') }}</UButton>
    </SharedFormActions>
  </form>
</template>
