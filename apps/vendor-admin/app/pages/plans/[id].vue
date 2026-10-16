<script setup lang="ts">
import { lifecycleBadge } from '@/utils/vendorCommercial'
import type { Quote } from '@nasq/commercial-contracts'
import { cadenceKey, commercialErrorKey, commercialReturnTo, keyLabel, limitLabel, parseCount, quoteRequestBody, type BundleView, type LifecycleAction, type PlanView } from '@/utils/vendorCommercial'
import { cadenceLabel, formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t, te, locale } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorCommercial(); const hydrated = useHydrated()
const id = computed(() => String(route.params.id)); const isEdit = computed(() => route.path.replace(/\/+$/, '').endsWith('/edit'))
const backTo = computed(() => commercialReturnTo(route.query.returnTo, '/plans'))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:plan:${id.value}`, async () => {
  const view = await api.get<PlanView>('plan', id.value)
  const ids = [...view.included_bundle_revision_ids, ...view.optional_bundle_revision_ids]
  const bundles = (await Promise.all(ids.map(x => api.get<BundleView>('bundle', x).catch(() => null)))).filter((b): b is BundleView => Boolean(b))
  return { view, bundles }
}, { watch: [id] })
const view = computed(() => data.value?.view)
const bundleName = (x: string) => data.value?.bundles.find(b => b.id === x)?.name ?? x
// Live server quote: inputs only; every amount comes from POST /commercial/quotes.
const cadence = ref(''); const extra = ref('0'); const optional = ref<string[]>([])
const quote = ref<Quote | null>(null); const quotePending = ref(false); const quoteError = ref(''); let timer: ReturnType<typeof setTimeout> | undefined; let seq = 0
watch(view, v => { if (v && !cadence.value && v.prices[0]) cadence.value = cadenceKey(v.prices[0].cadence) }, { immediate: true })
async function recompute() {
  const v = view.value; const count = parseCount(extra.value)
  if (!v || !cadence.value || count === null) { quote.value = null; quoteError.value = count === null ? t('vendor.pricing.quote.extraInvalid') : ''; return }
  const price = v.prices.find(p => cadenceKey(p.cadence) === cadence.value); if (!price) return
  const mine = ++seq; quotePending.value = true; quoteError.value = ''
  try { const result = await api.quote(quoteRequestBody({ plan: v, cadence: price.cadence, extraBranches: count, optionalBundleIds: optional.value })); if (mine === seq) quote.value = result }
  catch (cause) { if (mine === seq) { quote.value = null; quoteError.value = t(commercialErrorKey(cause)) } }
  finally { if (mine === seq) quotePending.value = false }
}
function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => void recompute(), 350) }
watch([cadence, extra, optional, view], schedule, { deep: true })
onMounted(() => void recompute()); onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
async function done(action: LifecycleAction, result: unknown) {
  await refreshNuxtData()
  if (action === 'delete') await navigateTo(backTo.value)
  else if (action === 'revisions' && result && typeof result === 'object' && 'id' in result) await navigateTo({ path: `/plans/${(result as PlanView).id}/edit`, query: { returnTo: backTo.value } })
  else await refresh()
}
const includedIds = computed(() => view.value?.included_bundle_revision_ids ?? [])
const bundleOf = (x: string) => data.value?.bundles.find(b => b.id === x)
const bundleTo = (x: string) => ({ path: `/bundles/${encodeURIComponent(x)}`, query: { returnTo: route.fullPath } })
const facts = computed(() => {
  const v = view.value; if (!v) return []
  const first = v.prices[0]
  return [
    { key: 'price', label: t('vendor.pricing.sections.prices'), value: first ? `${formatCommercialMoney(first.amount, locale.value)} · ${cadenceLabel(first.cadence, t)}` : t('vendor.pricing.prices.none') },
    { key: 'bundles', label: t('vendor.pricing.sections.bundles'), value: t('vendor.plans.bundlesCount', { included: v.included_bundle_revision_ids.length, optional: v.optional_bundle_revision_ids.length }) },
    { key: 'customers', label: t('vendor.customers.title'), value: t('vendor.pricing.customers', { count: v.customer_count }, v.customer_count) },
  ]
})
const editable = computed(() => view.value?.status === 'draft' && can('vendor.catalog.manage') && can('vendor.pricing.manage'))
const cadenceItems = computed(() => (view.value?.prices ?? []).map(p => ({ value: cadenceKey(p.cadence), label: `${cadenceLabel(p.cadence, t)} · ${formatCommercialMoney(p.amount, locale.value)}` })))
</script>
<template>
  <NuxtPage v-if="isEdit" />

    <SharedRecordPage v-else :title="view?.name ?? t('vendor.plans.details')" :back-to="backTo" :back-label="t('vendor.plans.title')" :loading="pending" :error="error" @retry="refresh">
      <template #actions><UButton v-if="view && editable" :to="{ path: `/plans/${view.id}/edit`, query: { returnTo: backTo } }" color="neutral" variant="outline">{{ t('vendor.pricing.edit') }}</UButton></template>

    <template v-if="view && data">
      <VendorCatalogFacts :facts="facts" class="mt-6">
        <template #status><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(view).tone" :label="t(lifecycleBadge(view).labelKey)" /></template>
      </VendorCatalogFacts>
      <SharedRecordSection :title="t('vendor.plans.sold')" :description="t('vendor.plans.soldHint')" class="mt-6" data-testid="plan-bundles">
        <ul class="grid gap-2 sm:grid-cols-2">
          <li v-for="x in [...view.included_bundle_revision_ids, ...view.optional_bundle_revision_ids]" :key="x" class="flex items-center justify-between gap-3 rounded-lg p-3 ring ring-default">
            <NuxtLink :to="bundleTo(x)" data-testid="plan-bundle-link" class="min-w-0 truncate font-medium hover:underline">{{ bundleName(x) }}</NuxtLink>
            <UBadge color="neutral" :variant="includedIds.includes(x) ? 'subtle' : 'outline'">{{ t(includedIds.includes(x) ? 'vendor.pricing.plan.included' : 'vendor.pricing.plan.optional') }}</UBadge>
          </li>
        </ul>
        <dl class="mt-4 grid gap-4 sm:grid-cols-2">
          <div v-for="(v, k) in view.platform_limits" :key="k"><dt class="text-sm text-muted">{{ keyLabel(String(k), t, te) }}</dt><dd class="font-semibold tabular-nums">{{ limitLabel(v, t) }}</dd></div>
          <div><dt class="text-sm text-muted">{{ t('vendor.pricing.fields.freeBranches') }}</dt><dd class="font-semibold tabular-nums">{{ view.included_extra_branches }}</dd></div>
          <div><dt class="text-sm text-muted">{{ t('vendor.pricing.fields.branchLimit') }}</dt><dd class="font-semibold tabular-nums">{{ limitLabel(view.extra_branches_limit, t) }}</dd></div>
        </dl>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.pricing.sections.prices')" class="mt-6">
        <ul class="grid gap-2 sm:grid-cols-2"><li v-for="p in view.prices" :key="cadenceKey(p.cadence)" class="flex justify-between rounded-lg p-3 ring ring-default"><span>{{ cadenceLabel(p.cadence, t) }}</span><span class="font-semibold tabular-nums">{{ formatCommercialMoney(p.amount, locale) }}</span></li></ul>
        <ul v-if="view.extra_branch_prices.length" class="mt-2 grid gap-2 sm:grid-cols-2"><li v-for="p in view.extra_branch_prices" :key="cadenceKey(p.cadence)" class="flex justify-between rounded-lg p-3 ring ring-default"><span>{{ t('vendor.pricing.fields.branchPrice') }} · {{ cadenceLabel(p.cadence, t) }}</span><span class="font-semibold tabular-nums">{{ formatCommercialMoney(p.amount, locale) }}</span></li></ul>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.pricing.quote.title')" :description="t('vendor.pricing.quote.hint')" class="mt-6" data-testid="quote-preview">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('commercial.pricing.quote.cadence')"><USelect v-model="cadence" :items="cadenceItems" class="w-full" :disabled="!hydrated" /></UFormField>
          <UFormField :label="t('vendor.pricing.quote.extraBranches')"><UInput v-model="extra" inputmode="numeric" dir="ltr" class="w-full" :disabled="!hydrated" /></UFormField>
        </div>
        <div v-if="view.optional_bundle_revision_ids.length" class="flex flex-wrap gap-4"><UCheckbox v-for="x in view.optional_bundle_revision_ids" :key="x" :model-value="optional.includes(x)" :label="bundleName(x)" :disabled="!hydrated" @update:model-value="optional = $event === true ? [...optional, x] : optional.filter(o => o !== x)" /></div>
        <SharedCommercePriceBreakdown :quote="quote" :pending="quotePending" :error="quoteError" @retry="recompute" />
      </SharedRecordSection>
      <VendorLifecyclePanel class="mt-6" kind="plan" :view="view" @done="done" @reload="refresh" />
      <details class="mt-6"><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.pricing.technical') }}</summary>
        <dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.pricing.contentDigest') }}</dt><dd class="break-all" dir="ltr">{{ view.content_digest }}</dd></div><div><dt>{{ t('vendor.pricing.revisionId') }}</dt><dd dir="ltr">{{ view.id }}</dd></div><div><dt>{{ t('vendor.pricing.editRevision') }}</dt><dd dir="ltr">{{ view.edit_revision }}</dd></div></dl>
      </details>
    </template>
  <template #aside><SharedPropertiesPanel v-if="view"><SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(view).tone" :label="t(lifecycleBadge(view).labelKey)" /></SharedPropertyRow><SharedPropertyRow :label="t('vendor.pricing.version', {count:view.version})" :value="view.version" /><SharedPropertyRow :label="t('vendor.pricing.fields.termMonths')" :value="view.term_months" /><SharedPropertyRow :label="t('vendor.pricing.fields.trialDays')" :value="view.trial_days" /><SharedPropertyRow :label="t('vendor.pricing.fields.graceDays')" :value="view.grace_days" /><SharedPropertyRow :label="t('vendor.pricing.fields.autoSuspend')" :value="view.auto_suspend ? t('vendor.common.yes') : t('vendor.common.no')" /><SharedPropertyRow :label="t('vendor.pricing.fields.autoRenew')" :value="view.auto_renew_allowed ? t('vendor.common.yes') : t('vendor.common.no')" /><SharedPropertyRow :label="t('vendor.customers.title')" :value="view.customer_count" /></SharedPropertiesPanel></template>
</SharedRecordPage>
</template>
