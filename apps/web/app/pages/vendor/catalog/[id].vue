<script setup lang="ts">
import type { PackageRevision } from '@nasq/commercial-contracts'
import { packageActionBody, packageErrorKey, packageLabel, packageListReturnTo, type PackageAction } from '@/utils/vendorPackages'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi(); const { can } = useVendorContext(); const hydrated = useHydrated()
const id = computed(() => String(route.params.id)); const isEdit = computed(() => route.path.endsWith('/edit')); const backTo = computed(() => packageListReturnTo(route.query.returnTo))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:package:${id.value}`, () => request<PackageRevision>(`packages/${encodeURIComponent(id.value)}`))
const { data: revisions, refresh: refreshRevisions } = await useAsyncData('vendor:packages', () => request<{ items: PackageRevision[]; total: number }>('packages'))
const history = computed(() => (revisions.value?.items ?? []).filter(item => item.package_id === data.value?.package_id).sort((a, b) => b.version - a.version))
const action = ref<PackageAction | null>(null); const reason = ref(''); const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null)
const dirty = computed(() => Boolean(action.value && reason.value.trim()))
const reasonError = computed(() => attempted.value && (reason.value.trim().length < 3 || reason.value.trim().length > 1000) ? t('vendor.packages.reasonRequired') : undefined)
const actions = computed<PackageAction[]>(() => !data.value ? [] : data.value.status === 'draft' ? ['validate', 'delete'] : data.value.status === 'validated' ? ['publish'] : ['revisions', data.value.available ? 'withdraw' : 'restore'])
function choose(value: PackageAction) { action.value = value; reason.value = ''; attempted.value = false; failure.value = null }
function cancelAction() { action.value = null; reason.value = ''; attempted.value = false }
async function perform() {
  if (!hydrated.value || !data.value || !action.value || busy.value || !can('vendor.catalog.manage')) return
  attempted.value = true
  if (reasonError.value) return
  busy.value = true; failure.value = null
  const currentAction = action.value
  try {
    const result = await request<PackageRevision | { deleted: true }>(`packages/${encodeURIComponent(data.value.id)}${currentAction === 'delete' ? '' : `/${currentAction}`}`, { method: currentAction === 'delete' ? 'DELETE' : 'POST', body: packageActionBody(currentAction, data.value.revision, reason.value) })
    cancelAction(); await refreshRevisions()
    if (currentAction === 'delete') await navigateTo(backTo.value)
    else if (currentAction === 'revisions' && 'id' in result) await navigateTo({ path: `/vendor/catalog/${result.id}/edit`, query: { returnTo: backTo.value } })
    else await refresh()
  } catch (cause) { failure.value = cause } finally { busy.value = false }
}
</script>
<template>
  <NuxtPage v-if="isEdit" />
  <SharedPageContainer v-else width="list">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <SharedPageHeader :title="data?.name ?? t('vendor.packages.details')" :description="data?.description" :back-to="backTo" :back-label="t('vendor.packages.title')"><template #actions><UButton v-if="data && data.status !== 'published' && can('vendor.catalog.manage')" :to="{ path: `/vendor/catalog/${data.id}/edit`, query: { returnTo: backTo } }" color="neutral" variant="outline">{{ t('vendor.packages.edit') }}</UButton></template></SharedPageHeader>
    <SharedPageState :loading="pending" :error="error" @retry="refresh"><template v-if="data">
      <div class="flex flex-wrap gap-2"><UBadge color="neutral" variant="subtle">{{ t(`vendor.packages.status.${data.status === 'published' && !data.available ? 'unavailable' : data.status}`) }}</UBadge><UBadge color="neutral" variant="outline">{{ t('vendor.packages.version', { count: data.version }) }}</UBadge><p class="text-sm text-muted">{{ t('vendor.packages.customers', { count: data.customer_count }) }}</p></div>
      <SharedFormSection :title="t('vendor.packages.included')" class="mt-6"><p>{{ packageLabel('tier', data.catalog_tier, t) }}</p><div class="flex flex-wrap gap-2"><UBadge v-for="module in data.modules" :key="module" color="neutral" variant="subtle">{{ packageLabel('module', module, t) }}</UBadge><UBadge v-for="feature in data.features.filter(value => value.startsWith('boolean:'))" :key="feature" color="neutral" variant="outline">{{ packageLabel('feature', feature, t) }}</UBadge></div></SharedFormSection>
      <SharedFormSection :title="t('vendor.packages.quotas')" :description="t('vendor.packages.storageHint')" class="mt-6"><dl class="grid gap-4 sm:grid-cols-3"><div v-for="(value, key) in data.limits" :key="key"><dt class="text-sm text-muted">{{ packageLabel('limit', key, t) }}</dt><dd class="font-semibold">{{ value === null ? t('vendor.common.unlimited') : value }}<span v-if="value === 0" class="ms-2 text-warning">{{ t('vendor.packages.noUsage') }}</span></dd></div></dl></SharedFormSection>
      <SharedFormSection v-if="can('vendor.catalog.manage')" class="mt-6" :title="t('vendor.packages.nextAction')" :description="t('vendor.packages.preserveCustomers')">
        <UAlert v-if="failure" color="error" variant="subtle" :title="t(packageErrorKey(failure))" />
        <div v-if="!action" class="flex flex-wrap gap-2"><UButton v-for="value in actions" :key="value" :color="value === 'delete' || value === 'withdraw' ? 'error' : 'neutral'" :variant="value === 'delete' || value === 'withdraw' ? 'ghost' : 'outline'" :disabled="!hydrated || busy" @click="choose(value)">{{ t(`vendor.packages.actions.${value}`) }}</UButton></div>
        <template v-else>
          <SharedInlineConfirm v-if="action === 'delete' || action === 'withdraw'" :title="t(`vendor.packages.actions.${action}`)" :description="t(`vendor.packages.effects.${action}`)" :confirm-label="t(`vendor.packages.actions.${action}`)" :pending="busy" @cancel="cancelAction" @confirm="perform"><UFormField :label="t('vendor.tenants.fields.reason')" required :error="reasonError" class="mt-3"><UTextarea v-model="reason" maxlength="1000" class="w-full" :disabled="busy" /></UFormField></SharedInlineConfirm>
          <form v-else class="space-y-4" novalidate @submit.prevent="perform"><UAlert color="neutral" variant="subtle" :title="t(`vendor.packages.actions.${action}`)" :description="t(`vendor.packages.effects.${action}`)" /><UFormField :label="t('vendor.tenants.fields.reason')" required :error="reasonError"><UTextarea v-model="reason" maxlength="1000" class="w-full" :disabled="busy" /></UFormField><div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" :disabled="busy" @click="cancelAction">{{ t('app.cancel') }}</UButton><UButton type="submit" :loading="busy" :disabled="!hydrated || busy">{{ t(`vendor.packages.actions.${action}`) }}</UButton></div></form>
        </template>
      </SharedFormSection>
      <SharedFormSection class="mt-6" :title="t('vendor.packages.history')"><ul class="space-y-2"><li v-for="item in history" :key="item.id"><NuxtLink :to="{ path: `/vendor/catalog/${item.id}`, query: { returnTo: backTo } }" class="text-primary">{{ item.name }} · {{ t('vendor.packages.version', { count: item.version }) }}</NuxtLink><span class="ms-2 text-sm text-muted">{{ t(`vendor.packages.status.${item.status === 'published' && !item.available ? 'unavailable' : item.status}`) }}</span></li></ul></SharedFormSection>
      <details class="mt-6"><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.packages.technical') }}</summary><dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.packages.source') }}</dt><dd>{{ data.catalog_version }} · {{ data.catalog_tier }}</dd></div><div><dt>{{ t('vendor.packages.sourceHash') }}</dt><dd class="break-all" dir="ltr">{{ data.source_sha256 }}</dd></div><div><dt>{{ t('vendor.packages.revisionId') }}</dt><dd dir="ltr">{{ data.id }}</dd></div></dl></details>
    </template></SharedPageState>
  </SharedPageContainer>
</template>
