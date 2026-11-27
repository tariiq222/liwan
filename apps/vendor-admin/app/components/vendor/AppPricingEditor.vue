<script setup lang="ts">
import type { CatalogRelease } from '@liwan/commercial-contracts'
import {
  actionBlockedReason, bundleDraftFromView, bundleLimitKeys, commercialErrorKey, commercialFailure,
  fieldIssue, isEditable, keyLabel, limitFromDraft, priceRowErrors, type BundleDraft, type BundleView,
} from '@/utils/vendorCommercial'
import { publishAddonPricing } from '@/utils/vendorAppPricing'
import { useVendorCommercial } from '@/composables/useVendorCommercial'

const props = defineProps<{ addon: BundleView; releases: CatalogRelease[] }>()
const emit = defineEmits<{
  done: [published: BundleView]
  cancel: [workingDraftCreated: boolean]
  reload: []
  'working-draft': [draft: BundleView | null]
  busy: [busy: boolean]
}>()

const { t, te } = useI18n()
const hydrated = useHydrated()
const { can } = useVendorContext()
const api = useVendorCommercial()

const workingDraft = ref<BundleView | null>(null)
const activeAddon = computed(() => workingDraft.value ?? props.addon)
const addonRelease = computed(() => props.releases.find(r => r.id === activeAddon.value.catalog_release_id))
const blockedReason = computed(() => actionBlockedReason('bundle', 'publish', can as never))

const selectedAppIds = computed(() => activeAddon.value.selections.map(s => s.app_id))
const keys = computed(() => bundleLimitKeys(addonRelease.value, selectedAppIds.value))
const labels = computed(() => Object.fromEntries(keys.value.map(k => [k, keyLabel(k, t, te)])))

function buildDraft(view: BundleView): BundleDraft {
  const next = bundleDraftFromView(view)
  const rel = props.releases.find(r => r.id === view.catalog_release_id)
  for (const key of bundleLimitKeys(rel, view.selections.map(s => s.app_id))) {
    next.limits[key] ??= { mode: '', value: '' }
  }
  return next
}

const draft = reactive<BundleDraft>(buildDraft(props.addon))
watch(keys, (values) => {
  for (const key of values) draft.limits[key] ??= { mode: '', value: '' }
}, { immediate: true })

const snapshot = () => JSON.stringify({ prices: draft.prices, limits: draft.limits, reason: draft.reason })
const baseline = ref(snapshot())
const attempted = ref(false)
const busy = ref(false)
const failure = ref<unknown>(null)
const dirty = computed(() => snapshot() !== baseline.value)

watch(() => `${props.addon.id}:${props.addon.edit_revision}`, () => {
  if (workingDraft.value) return
  Object.assign(draft, buildDraft(props.addon))
  baseline.value = snapshot()
  attempted.value = false
  failure.value = null
})

const parsed = computed(() => (failure.value ? commercialFailure(failure.value) : null))
const issues = computed(() => parsed.value?.issues ?? [])
const serverIssue = (field: string) => {
  const code = fieldIssue(parsed.value, field)
  return code ? t(commercialErrorKey({ code })) : undefined
}
const serverLimitErrors = computed(() => Object.fromEntries(keys.value.flatMap((k) => {
  const err = serverIssue(`domain_limits.${k}`)
  return err ? [[k, err]] : []
})))

const errors = computed(() => {
  const e: Record<string, string> = {}
  for (const k of keys.value) {
    try { limitFromDraft(draft.limits[k]) } catch { e.limits = t('vendor.pricing.limit.required') }
  }
  if (priceRowErrors(draft.prices).some(Boolean)) e.prices = t('vendor.pricing.prices.invalid')
  const len = draft.reason.trim().length
  if (len < 3 || len > 1000) e.reason = t('vendor.pricing.reasonRequired')
  return e
})

const disabled = computed(() => !hydrated.value || busy.value || !addonRelease.value || Boolean(blockedReason.value))

async function submit() {
  if (disabled.value) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  const release = addonRelease.value
  if (!release) return
  busy.value = true
  emit('busy', true)
  failure.value = null
  try {
    const published = await publishAddonPricing({
      api,
      current: activeAddon.value,
      nextDraft: draft,
      release,
      reason: draft.reason,
      onWorkingDraft: (next) => {
        workingDraft.value = next
        emit('working-draft', next)
      },
    })
    workingDraft.value = null
    emit('working-draft', null)
    draft.reason = ''
    attempted.value = false
    baseline.value = snapshot()
    emit('done', published)
  } catch (cause) {
    failure.value = cause
  } finally {
    busy.value = false
    emit('busy', false)
  }
}

function reload() {
  workingDraft.value = null
  emit('working-draft', null)
  failure.value = null
  attempted.value = false
  Object.assign(draft, buildDraft(props.addon))
  baseline.value = snapshot()
  emit('reload')
}

function cancel() {
  const created = workingDraft.value !== null
  workingDraft.value = null
  emit('working-draft', null)
  emit('cancel', created)
}
</script>
<template>
  <SharedRecordSection variant="panel" :title="t('vendor.catalog.app.pricingEditor.title')" data-testid="catalog-app-pricing-editor">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <form class="space-y-(--liwan-gap-section)" novalidate @submit.prevent="submit">
      <UAlert v-if="!addonRelease" color="error" variant="subtle" :title="t('vendor.catalog.app.pricingEditor.releaseMissing')" />
      <UAlert v-if="blockedReason" color="neutral" variant="subtle" :title="t(`vendor.pricing.blocked.${blockedReason}`)" />
      <UAlert color="neutral" variant="subtle" :title="t(isEditable(activeAddon) ? 'vendor.catalog.app.pricingEditor.draftNotice' : 'vendor.catalog.app.pricingEditor.publishedNotice')" />
      <UAlert v-if="parsed?.conflict" color="warning" variant="subtle" :title="t('vendor.pricing.errors.revision_conflict')">
        <template #actions>
          <UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated || busy" @click="reload">{{ t('vendor.pricing.reload') }}</UButton>
        </template>
      </UAlert>
      <UAlert v-else-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(failure))" :description="parsed?.field ? t('vendor.pricing.errors.atField', { field: parsed.field }) : undefined" />
      <ul v-if="issues.length" class="space-y-1 text-sm text-warning" data-testid="issues">
        <li v-for="issue in issues" :key="`${issue.code}-${issue.field ?? ''}`">
          {{ t(commercialErrorKey({ code: issue.code })) }}<bdi v-if="issue.field" class="ms-2 text-muted" dir="ltr">{{ issue.field }}</bdi>
        </li>
      </ul>
      <SharedFormSection :title="t('vendor.pricing.sections.prices')" :description="t('vendor.pricing.bundle.pricesHint')">
        <VendorPriceListEditor v-model="draft.prices" :label="t('vendor.pricing.sections.prices')" :disabled="disabled" :show-errors="attempted" :server-error="serverIssue('prices')" />
        <p v-if="attempted && errors.prices" class="text-sm text-error">{{ errors.prices }}</p>
      </SharedFormSection>
      <SharedFormSection v-if="keys.length" :title="t('vendor.pricing.sections.limits')" :description="t('vendor.pricing.bundle.limitsHint')">
        <VendorCapacityLimitsEditor v-model="draft.limits" :keys="keys" :labels="labels" :disabled="disabled" :show-errors="attempted" :server-errors="serverLimitErrors" />
      </SharedFormSection>
      <SharedFormSection :title="t('vendor.pricing.sections.review')">
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="attempted ? errors.reason : serverIssue('reason')">
          <UTextarea v-model="draft.reason" maxlength="1000" class="w-full" data-testid="catalog-app-pricing-reason" :disabled="disabled" />
        </UFormField>
      </SharedFormSection>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" :disabled="!hydrated || busy" @click="cancel">{{ t('vendor.catalog.app.pricingEditor.cancel') }}</UButton>
        <UButton type="submit" :loading="busy" :disabled="disabled" data-testid="catalog-app-pricing-submit">{{ t('vendor.catalog.app.pricingEditor.submit') }}</UButton>
      </div>
    </form>
  </SharedRecordSection>
</template>
