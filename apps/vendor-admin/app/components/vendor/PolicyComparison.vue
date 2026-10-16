<script setup lang="ts">
// The settings a workspace should have next to the ones the service last reported, row by row.
const props = defineProps<{ desired: Record<string, unknown> | null; observed: Record<string, unknown> | null }>()
const { t, te } = useI18n()
function valueText(value: unknown): string {
  if (value === undefined) return t('vendor.common.none')
  if (value === null) return t('vendor.common.unlimited')
  if (typeof value === 'boolean') return t(value ? 'vendor.common.enabled' : 'vendor.common.disabled')
  return String(value)
}
const rows = computed(() => {
  const desired = props.desired ?? {}
  const observed = props.observed ?? {}
  const keys = [...new Set([...Object.keys(desired), ...Object.keys(observed)])].sort()
  return keys.map(key => ({ key, label: te(`vendor.features.${key}`) ? t(`vendor.features.${key}`) : key, desired: valueText(desired[key]), observed: valueText(observed[key]), same: desired[key] === observed[key] }))
})
const pendingCount = computed(() => rows.value.filter(row => !row.same).length)
</script>

<template>
  <div data-slot="policy-comparison">
    <SharedEmptyState v-if="!rows.length" :title="t('vendor.tenants.policyEmpty')" />
    <template v-else>
      <p class="mb-3 text-sm" :class="pendingCount ? 'text-warning-800 dark:text-warning' : 'text-muted'" role="status">
        {{ pendingCount ? t('vendor.tenants.policyDiffers', { count: pendingCount }) : t('vendor.tenants.policyMatches') }}
      </p>
      <div class="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 border-b border-default pb-2 text-xs text-muted sm:grid" aria-hidden="true">
        <span>{{ t('vendor.tenants.policyFeature') }}</span><span>{{ t('vendor.tenants.desiredPolicy') }}</span><span>{{ t('vendor.tenants.observedPolicy') }}</span><span class="w-24" />
      </div>
      <ul class="divide-y divide-default">
        <li v-for="row in rows" :key="row.key" class="grid gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center" data-testid="policy-row" :data-same="row.same">
          <p class="font-medium text-highlighted">{{ row.label }}</p>
          <p><span class="text-muted sm:hidden">{{ t('vendor.tenants.desiredPolicy') }}: </span><bdi class="tabular-nums">{{ row.desired }}</bdi></p>
          <p><span class="text-muted sm:hidden">{{ t('vendor.tenants.observedPolicy') }}: </span><bdi class="tabular-nums">{{ row.observed }}</bdi></p>
          <p class="sm:w-24"><SharedStatusBadge :tone="row.same ? 'success' : 'warning'" :label="row.same ? t('vendor.tenants.policySame') : t('vendor.tenants.policyNotApplied')" /></p>
        </li>
      </ul>
    </template>
  </div>
</template>
