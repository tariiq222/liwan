<script setup lang="ts">
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { cadenceLabel, formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { type BundleView, type LifecycleAction, type PlanView } from '@/utils/vendorCommercial'
import { catalogReturn, plansUsingBundle, priceFact } from '@/utils/vendorCatalog'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t, locale } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorCommercial()
const id = computed(() => String(route.params.id)); const isEdit = computed(() => route.path.replace(/\/+$/, '').endsWith('/edit'))
const back = computed(() => catalogReturn(route.query.returnTo, 'bundles')); const backTo = computed(() => back.value.to)
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:bundle:${id.value}`, async () => {
  const view = await api.get<BundleView>('bundle', id.value)
  const [releases, versions, plans] = await Promise.all([api.releases().catch(() => []), api.bundleVersions(view.bundle_id).catch(() => null), plansUsingBundle(page => api.listPlans(page), view.id)])
  return { view, release: releases.find(r => r.id === view.catalog_release_id), versions: versions ?? [], usedBy: plans }
}, { watch: [id] })
const view = computed(() => data.value?.view)
async function done(action: LifecycleAction, result: unknown) {
  await refreshNuxtData()
  if (action === 'delete') await navigateTo(backTo.value)
  else if (action === 'revisions' && result && typeof result === 'object' && 'id' in result) await navigateTo({ path: `/bundles/${(result as BundleView).id}/edit`, query: { returnTo: backTo.value } })
  else await refresh()
}
const planTo = (p: PlanView) => ({ path: `/plans/${encodeURIComponent(p.id)}`, query: { returnTo: route.fullPath } })
const facts = computed(() => {
  const v = view.value; if (!v) return []
  return [
    { key: 'price', label: t('vendor.pricing.sections.prices'), value: priceFact(v.prices, price => `${formatCommercialMoney(price.amount, locale.value)} · ${cadenceLabel(price.cadence, t)}`, { none: t('vendor.pricing.prices.none'), more: count => t('vendor.pricing.prices.more', { count }) }) },
    { key: 'apps', label: t('vendor.pricing.sections.included'), value: v.selections.length },
    { key: 'plans', label: t('vendor.plans.title'), value: data.value?.usedBy ? data.value.usedBy.length : '—' },
    { key: 'customers', label: t('vendor.customers.title'), value: t('vendor.pricing.customers', { count: v.customer_count }, v.customer_count) },
  ]
})
const editable = computed(() => view.value?.status === 'draft' && can('vendor.catalog.manage'))
</script>
<template>
  <NuxtPage v-if="isEdit" />

    <SharedRecordPage v-else :title="view?.name ?? t('vendor.bundles.details')" :description="view?.description" :back-to="backTo" :back-label="t(back.labelKey)" :loading="pending" :error="error" @retry="refresh">
      <template #actions><UButton v-if="view && editable" :to="{ path: `/bundles/${view.id}/edit`, query: { returnTo: backTo } }" color="neutral" variant="outline">{{ t('vendor.pricing.edit') }}</UButton></template>

    <template v-if="view && data">

      <VendorCatalogFacts :facts="facts" class="mt-6">
        <template #status><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(view).tone" :label="t(lifecycleBadge(view).labelKey)" /></template>
      </VendorCatalogFacts>
      <SharedRecordSection :title="t('vendor.pricing.sections.included')" class="mt-6"><VendorEntitlementSummary :release="data.release" :selections="view.selections" :limits="view.domain_limits" /></SharedRecordSection>
      <SharedRecordSection :title="t('vendor.pricing.sections.prices')" class="mt-6">
        <p v-if="!view.prices.length" class="text-sm text-warning">{{ t('vendor.pricing.prices.none') }}</p>
        <ul class="grid gap-2 sm:grid-cols-2"><li v-for="p in view.prices" :key="`${p.cadence.unit}${p.cadence.count}`" class="flex justify-between rounded-lg p-3 ring ring-default"><span>{{ cadenceLabel(p.cadence, t) }}</span><span class="font-semibold tabular-nums">{{ formatCommercialMoney(p.amount, locale) }}</span></li></ul>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.bundles.usedBy')" :description="t('vendor.bundles.usedByHint')" class="mt-6" data-testid="bundle-plans">
        <p v-if="!data.usedBy" class="text-sm text-muted">{{ t('vendor.bundles.usedByUnavailable') }}</p>
        <p v-else-if="!data.usedBy.length" class="text-sm text-muted">{{ t('vendor.bundles.usedByNone') }}</p>
        <ul v-else class="grid gap-2 sm:grid-cols-2"><li v-for="p in data.usedBy" :key="p.id" class="flex items-center justify-between gap-3 rounded-lg p-3 ring ring-default"><span class="flex min-w-0 items-center gap-2"><NuxtLink :to="planTo(p)" data-testid="bundle-plan-link" class="min-w-0 truncate font-medium hover:underline">{{ p.name }}</NuxtLink><span class="shrink-0 text-sm text-muted">{{ t('vendor.pricing.version', { count: p.version }) }}</span><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(p).tone" :label="t(lifecycleBadge(p).labelKey)" /></span><UBadge color="neutral" :variant="p.included_bundle_revision_ids.includes(view.id) ? 'subtle' : 'outline'">{{ t(p.included_bundle_revision_ids.includes(view.id) ? 'vendor.pricing.plan.included' : 'vendor.pricing.plan.optional') }}</UBadge></li></ul>
      </SharedRecordSection>
      <VendorLifecyclePanel class="mt-6" kind="bundle" :view="view" @done="done" @reload="refresh" />
      <SharedRecordSection class="mt-6" :title="t('vendor.pricing.history')"><ul class="space-y-2"><li v-for="item in data.versions" :key="item.id"><NuxtLink :to="{ path: `/bundles/${item.id}`, query: { returnTo: backTo } }" class="text-primary">{{ item.name }} · {{ t('vendor.pricing.version', { count: item.version }) }}</NuxtLink><span class="ms-2"><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(item).tone" :label="t(lifecycleBadge(item).labelKey)" /></span></li></ul></SharedRecordSection>
      <details class="mt-6"><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.pricing.technical') }}</summary>
        <dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.pricing.contentDigest') }}</dt><dd class="break-all" dir="ltr">{{ view.content_digest }}</dd></div><div v-if="view.validated_digest"><dt>{{ t('vendor.pricing.validatedDigest') }}</dt><dd class="break-all" dir="ltr">{{ view.validated_digest }}</dd></div><div><dt>{{ t('vendor.pricing.revisionId') }}</dt><dd dir="ltr">{{ view.id }}</dd></div><div><dt>{{ t('vendor.pricing.editRevision') }}</dt><dd dir="ltr">{{ view.edit_revision }}</dd></div></dl>
      </details>
    </template>
  <template #aside><SharedPropertiesPanel v-if="view"><SharedPropertyRow :label="t('vendor.pricing.version', {count:view.version})" :value="view.version" /><SharedPropertyRow :label="t('vendor.pricing.fields.audience')" :value="t(`vendor.pricing.audience.${view.audience.kind}`)" /></SharedPropertiesPanel></template>
</SharedRecordPage>
</template>
