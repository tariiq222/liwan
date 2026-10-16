<script setup lang="ts">
import type { CatalogRelease } from '@webvue/commercial-contracts'
import { appName, bundleLimitKeys, bundleDraftFromView, dependencyHints, emptyBundleDraft, keyLabel, commercialFailure, commercialErrorKey, fieldIssue, limitFromDraft, priceRowErrors, type BundleDraft, type BundleView, type LimitDraft } from '@/utils/vendorCommercial'
const props = withDefaults(defineProps<{ releases: CatalogRelease[]; initial?: BundleView; busy?: boolean; error?: unknown; resetKey?: number; requireReason?: boolean; canPrice?: boolean }>(), { busy: false, resetKey: 0, requireReason: false, canPrice: true })
const emit = defineEmits<{ save: [draft: BundleDraft, release: CatalogRelease | undefined]; cancel: [] }>()
const { t, te, locale } = useI18n(); const hydrated = useHydrated()
const draft = reactive<BundleDraft>(props.initial ? bundleDraftFromView(props.initial) : emptyBundleDraft())
if (!draft.catalog_release_id && props.releases.length === 1) draft.catalog_release_id = props.releases[0]!.id
const release = computed(() => props.releases.find(r => r.id === draft.catalog_release_id))
const selectableApps = computed(() => (release.value?.applications ?? []).filter(a => a.selectable))
const coreApps = computed(() => (release.value?.applications ?? []).filter(a => !a.selectable))
const selectedIds = computed(() => Object.entries(draft.apps).filter(([, v]) => v.selected).map(([id]) => id))
const keys = computed(() => bundleLimitKeys(release.value, selectedIds.value))
watch(keys, values => { for (const key of values) draft.limits[key] ??= { mode: '', value: '' } }, { immediate: true })
watch(() => draft.catalog_release_id, () => { if (!props.initial || props.initial.catalog_release_id !== draft.catalog_release_id) { draft.apps = {}; draft.limits = {} } })
const hints = computed(() => dependencyHints(release.value, selectedIds.value))
const name = (id: string) => { const a = release.value?.applications.find(x => x.id === id); return a ? appName(a, locale.value) : id }
const labels = computed(() => Object.fromEntries(keys.value.map(k => [k, keyLabel(k, t, te)])))
const serialized = () => JSON.stringify(draft)
const baseline = ref(serialized()); const attempted = ref(false)
const dirty = computed(() => serialized() !== baseline.value)
watch(() => props.resetKey, () => { baseline.value = serialized(); attempted.value = false })
const failure = computed(() => (props.error ? commercialFailure(props.error) : null))
const serverIssue = (field: string) => { const code = fieldIssue(failure.value, field); return code ? t(commercialErrorKey({ code })) : undefined }
const serverLimitErrors = computed(() => Object.fromEntries(keys.value.flatMap(k => { const e = serverIssue(`domain_limits.${k}`); return e ? [[k, e]] : [] })))
const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!draft.name.trim()) e.name = t('vendor.pricing.required')
  if (!draft.description.trim()) e.description = t('vendor.pricing.required')
  if (!draft.catalog_release_id) e.release = t('vendor.pricing.required')
  if (draft.audience.kind === 'customer' && !draft.audience.customer_id.trim()) e.audience = t('vendor.pricing.required')
  if (!selectedIds.value.length) e.apps = t('vendor.pricing.bundle.appsRequired')
  if (hints.value.missing.length || hints.value.conflicts.length) e.apps = t('vendor.pricing.bundle.dependencyBlock')
  for (const k of keys.value) { try { limitFromDraft(draft.limits[k]) } catch { e.limits = t('vendor.pricing.limit.required') } }
  if (priceRowErrors(draft.prices).some(Boolean)) e.prices = t('vendor.pricing.prices.invalid')
  if (props.requireReason && draft.reason.trim().length < 3) e.reason = t('vendor.pricing.reasonRequired')
  return e
})
function toggleApp(id: string, value: boolean) { draft.apps[id] = { selected: value, features: value ? (draft.apps[id]?.features ?? []) : [] } }
function toggleFeature(appId: string, key: string, value: boolean) {
  const cur = draft.apps[appId] ?? { selected: true, features: [] }
  draft.apps[appId] = { selected: true, features: value ? [...new Set([...cur.features, key])] : cur.features.filter(k => k !== key) }
}
function submit() {
  if (!hydrated.value || props.busy) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  emit('save', draft, release.value)
}
const audienceItems = computed(() => [{ label: t('vendor.pricing.audience.public'), value: 'public' }, { label: t('vendor.pricing.audience.customer'), value: 'customer' }])
const dis = computed(() => !hydrated.value || props.busy)
</script>
<template>
  <form class="space-y-6" novalidate data-testid="bundle-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <UAlert v-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(error))" :description="failure.field ? t('vendor.pricing.errors.atField', { field: failure.field }) : undefined" />
    <SharedFormSection :title="t('vendor.pricing.sections.basics')">
      <UFormField :label="t('vendor.pricing.fields.name')" required :error="attempted ? errors.name : serverIssue('name')"><UInput v-model="draft.name" maxlength="200" class="w-full" :disabled="dis" /></UFormField>
      <UFormField :label="t('vendor.pricing.fields.description')" required :error="attempted ? errors.description : serverIssue('description')"><UTextarea v-model="draft.description" maxlength="2000" class="w-full" :disabled="dis" /></UFormField>
      <UFormField :label="t('vendor.pricing.fields.audience')" required :error="attempted ? errors.audience : serverIssue('audience')">
        <div class="flex flex-wrap gap-2"><USelect v-model="draft.audience.kind" :items="audienceItems" :disabled="dis" :aria-label="t('vendor.pricing.fields.audience')" /><UInput v-if="draft.audience.kind === 'customer'" v-model="draft.audience.customer_id" dir="ltr" :placeholder="t('vendor.pricing.audience.customerId')" :aria-label="t('vendor.pricing.audience.customerId')" :disabled="dis" /></div>
      </UFormField>
    </SharedFormSection>
    <SharedFormSection :title="t('vendor.pricing.sections.release')" :description="t('vendor.pricing.bundle.releaseHint')">
      <UFormField :label="t('vendor.pricing.fields.release')" required :error="attempted ? errors.release : serverIssue('catalog_release_id')"><USelect v-model="draft.catalog_release_id" :items="releases.map(r => ({ label: r.version, value: r.id }))" :placeholder="t('vendor.pricing.choose')" class="w-full" :disabled="dis" /></UFormField>
    </SharedFormSection>
    <SharedFormSection v-if="release" :title="t('vendor.pricing.sections.apps')" :description="t('vendor.pricing.bundle.appsHint')">
      <p v-if="attempted && errors.apps" class="text-sm text-error">{{ errors.apps }}</p>
      <p v-else-if="serverIssue('selections')" class="text-sm text-error">{{ serverIssue('selections') }}</p>
      <div v-for="app in coreApps" :key="app.id" class="rounded-lg bg-elevated p-3"><p class="font-medium">{{ appName(app, locale) }}</p><p class="text-sm text-muted">{{ t('commercial.pricing.summary.included') }}</p></div>
      <div v-for="app in selectableApps" :key="app.id" class="space-y-2 rounded-lg p-3 ring ring-default">
        <UCheckbox :model-value="draft.apps[app.id]?.selected ?? false" :label="appName(app, locale)" :disabled="dis" @update:model-value="toggleApp(app.id, $event === true)" />
        <div v-if="draft.apps[app.id]?.selected" class="ms-6 space-y-1">
          <template v-for="f in app.features.filter(x => x.kind === 'boolean')" :key="f.key">
            <UCheckbox v-if="f.selectable" :model-value="draft.apps[app.id]?.features.includes(f.key)" :label="keyLabel(f.key, t, te)" :disabled="dis" @update:model-value="toggleFeature(app.id, f.key, $event === true)" />
            <p v-else class="flex items-center gap-2 text-sm text-muted"><UIcon name="i-lucide-lock" />{{ keyLabel(f.key, t, te) }} · {{ t('commercial.pricing.summary.included') }}</p>
          </template>
        </div>
      </div>
      <UAlert v-for="h in hints.missing" :key="`m-${h.app}-${h.requires}`" color="warning" variant="subtle" :title="t('vendor.pricing.bundle.requires', { app: name(h.app), other: name(h.requires) })" />
      <UAlert v-for="h in hints.conflicts" :key="`c-${h.app}-${h.with}`" color="warning" variant="subtle" :title="t('vendor.pricing.bundle.conflicts', { app: name(h.app), other: name(h.with) })" />
    </SharedFormSection>
    <SharedFormSection v-if="keys.length" :title="t('vendor.pricing.sections.limits')" :description="t('vendor.pricing.bundle.limitsHint')">
      <VendorCapacityLimitsEditor v-model="draft.limits" :keys="keys" :labels="labels" :disabled="dis" :show-errors="attempted" :server-errors="serverLimitErrors" />
    </SharedFormSection>
    <SharedFormSection :title="t('vendor.pricing.sections.prices')" :description="canPrice ? t('vendor.pricing.bundle.pricesHint') : t('vendor.pricing.errors.pricingRequired')">
      <VendorPriceListEditor v-model="draft.prices" :label="t('vendor.pricing.sections.prices')" :disabled="dis || !canPrice" :show-errors="attempted" :server-error="serverIssue('prices')" />
      <p v-if="attempted && errors.prices" class="text-sm text-error">{{ errors.prices }}</p>
    </SharedFormSection>
    <SharedFormSection v-if="requireReason" :title="t('vendor.pricing.sections.review')">
      <UFormField :label="t('vendor.pricing.fields.reason')" required :error="attempted ? errors.reason : serverIssue('reason')"><UTextarea v-model="draft.reason" maxlength="1000" class="w-full" :disabled="dis" /></UFormField>
    </SharedFormSection>
    <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" :disabled="dis" @click="emit('cancel')">{{ t('app.cancel') }}</UButton><UButton type="submit" :loading="busy" :disabled="dis">{{ t('vendor.pricing.saveDraft') }}</UButton></div>
  </form>
</template>
