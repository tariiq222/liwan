<script setup lang="ts">
import { catalogLabel, tierLabel } from '@/utils/catalogLabels'
import { keyLabel, limitLabel } from '@/utils/vendorCommercial'
import type { CatalogDiff } from '@/utils/catalogDiff'
// The full change between two catalog versions, whole or narrowed to one application: chips for what was added or
// removed, one line per changed limit ceiling, and the sellable flips.
const props = defineProps<{ diff: CatalogDiff, appId?: string }>()
const { t, te } = useI18n()
const apps = computed(() => (props.appId ? props.diff.apps.filter(app => app.appId === props.appId) : props.diff.apps))
const empty = computed(() => (props.appId
  ? apps.value.length === 0
  : !props.diff.appsAdded.length && !props.diff.appsRemoved.length && !props.diff.baseModulesAdded.length && !props.diff.baseModulesRemoved.length && !apps.value.length))
const appLabel = (id: string) => tierLabel(id, undefined, t, te)
const limitText = (change: { key: string, from: number | undefined, to: number | undefined }) =>
  t('vendor.catalog.diff.limitChange', { key: keyLabel(change.key, t, te), from: limitLabel(change.from, t, change.key), to: limitLabel(change.to, t, change.key) })
</script>
<template>
  <div data-testid="catalog-diff-detail" class="space-y-3 text-sm">
    <p v-if="empty" class="text-muted" data-testid="catalog-diff-none">{{ t('vendor.catalog.diff.none') }}</p>
    <template v-else>
      <div v-if="!appId && diff.appsAdded.length" class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted">{{ t('vendor.catalog.diff.appsAddedList') }}</span>
        <UBadge v-for="id in diff.appsAdded" :key="id" color="success" variant="subtle">{{ appLabel(id) }}</UBadge>
      </div>
      <div v-if="!appId && diff.appsRemoved.length" class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted">{{ t('vendor.catalog.diff.appsRemovedList') }}</span>
        <UBadge v-for="id in diff.appsRemoved" :key="id" color="error" variant="subtle">{{ appLabel(id) }}</UBadge>
      </div>
      <div v-if="!appId && (diff.baseModulesAdded.length || diff.baseModulesRemoved.length)" class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted">{{ t('vendor.catalog.baseModules') }}</span>
        <UBadge v-for="module in diff.baseModulesAdded" :key="module" color="success" variant="subtle">{{ catalogLabel('module', module, t) }}</UBadge>
        <UBadge v-for="module in diff.baseModulesRemoved" :key="module" color="error" variant="subtle">{{ catalogLabel('module', module, t) }}</UBadge>
      </div>
      <ul class="space-y-3">
        <li v-for="app in apps" :key="app.appId" class="rounded-control p-3 ring ring-default" :data-app="app.appId" data-testid="catalog-diff-app">
          <p class="flex flex-wrap items-center gap-2 font-medium">{{ appLabel(app.appId) }}<UBadge v-if="app.added" color="success" variant="subtle">{{ t('vendor.catalog.diff.appAdded') }}</UBadge></p>
          <div v-if="app.featuresAdded.length" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="text-muted">{{ t('vendor.catalog.diff.added') }}</span>
            <UBadge v-for="feature in app.featuresAdded" :key="feature.raw" color="success" variant="subtle">{{ catalogLabel('feature', feature.raw, t) }}</UBadge>
          </div>
          <div v-if="app.featuresRemoved.length" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="text-muted">{{ t('vendor.catalog.diff.removed') }}</span>
            <UBadge v-for="feature in app.featuresRemoved" :key="feature.raw" color="error" variant="subtle">{{ catalogLabel('feature', feature.raw, t) }}</UBadge>
          </div>
          <p v-for="change in app.limitChanges" :key="change.key" class="mt-2">{{ limitText(change) }}</p>
          <p v-if="app.sellableFrom !== app.sellableTo" class="mt-2">{{ t(app.sellableTo ? 'vendor.catalog.diff.sellableOn' : 'vendor.catalog.diff.sellableOff') }}</p>
          <div v-if="app.modulesAdded.length || app.modulesRemoved.length" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="text-muted">{{ t('vendor.catalog.app.modules') }}</span>
            <UBadge v-for="module in app.modulesAdded" :key="module" color="success" variant="subtle">{{ catalogLabel('module', module, t) }}</UBadge>
            <UBadge v-for="module in app.modulesRemoved" :key="module" color="error" variant="subtle">{{ catalogLabel('module', module, t) }}</UBadge>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
