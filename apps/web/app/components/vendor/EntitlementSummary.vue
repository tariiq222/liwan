<script setup lang="ts">
import type { CapacityMap, CatalogRelease, Selection } from '@nasq/commercial-contracts'
import { appName, keyLabel, limitLabel } from '@/utils/vendorCommercial'
const props = defineProps<{ release?: CatalogRelease | null; selections: Selection[]; limits?: CapacityMap; includeCore?: boolean }>()
const { t, te, locale } = useI18n()
const apps = computed(() => {
  const release = props.release
  const selected = props.selections.map(s => ({ s, app: release?.applications.find(a => a.id === s.app_id) }))
  const core = props.includeCore ? (release?.applications ?? []).filter(a => !a.selectable).map(app => ({ s: { app_id: app.id, feature_keys: [] as string[] }, app })) : []
  return [...core, ...selected].map(({ s, app }) => ({ id: s.app_id, name: app ? appName(app, locale.value) : s.app_id, features: s.feature_keys.map(k => keyLabel(k, t, te)), locked: (app?.features ?? []).filter(f => f.kind === 'boolean' && !f.selectable).map(f => keyLabel(f.key, t, te)) }))
})
const limits = computed(() => Object.entries(props.limits ?? {}).sort(([a], [b]) => a.localeCompare(b)))
</script>
<template>
  <div class="space-y-4" data-slot="entitlement-summary">
    <p class="text-sm text-muted">{{ t('vendor.pricing.summary.intro') }}</p>
    <p v-if="!apps.length" class="text-sm text-muted">{{ t('vendor.pricing.summary.noApps') }}</p>
    <ul v-else class="space-y-3">
      <li v-for="app in apps" :key="app.id" class="rounded-lg p-3 ring ring-default">
        <p class="font-medium">{{ app.name }}</p>
        <div v-if="app.features.length || app.locked.length" class="mt-2 flex flex-wrap gap-2">
          <UBadge v-for="f in app.features" :key="f" color="neutral" variant="subtle">{{ f }}</UBadge>
          <UBadge v-for="f in app.locked" :key="`l-${f}`" color="neutral" variant="outline" icon="i-lucide-lock">{{ f }} · {{ t('commercial.pricing.summary.included') }}</UBadge>
        </div>
      </li>
    </ul>
    <dl v-if="limits.length" class="grid gap-3 sm:grid-cols-2">
      <div v-for="[key, value] in limits" :key="key"><dt class="text-sm text-muted">{{ keyLabel(key, t, te) }}</dt><dd class="font-semibold tabular-nums">{{ limitLabel(value, t) }}</dd></div>
    </dl>
  </div>
</template>
