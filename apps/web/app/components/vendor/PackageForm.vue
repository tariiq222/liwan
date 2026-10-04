<script setup lang="ts">
import { type PackageInput, type PackageRevision } from '@nasq/commercial-contracts'
import { packageFormInput, packageLabel, packageLimitKeys, packageLimitValue, packageErrorKey, type PackageCatalog, type PackageLimitDraft } from '@/utils/vendorPackages'
const props = withDefaults(defineProps<{ catalogs: PackageCatalog[]; initial?: PackageRevision; busy?: boolean; error?: unknown; resetKey?: number }>(), { busy: false, resetKey: 0 })
const emit = defineEmits<{ save: [PackageInput]; cancel: [] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const draft = reactive({ name: props.initial?.name ?? '', description: props.initial?.description ?? '', catalog_version: props.initial?.catalog_version ?? '', catalog_tier: props.initial?.catalog_tier ?? '' })
const limits = reactive<Record<string, PackageLimitDraft>>(Object.fromEntries(Object.entries(props.initial?.limits ?? {}).map(([key, value]) => [key, { mode: value === null ? 'unlimited' : 'limited', value: value === null ? '' : String(value) }])))
const source = computed(() => props.catalogs.find(item => item.version === draft.catalog_version))
const tier = computed(() => source.value?.solution.tiers?.find(item => item.id === draft.catalog_tier))
const keys = computed(() => packageLimitKeys(tier.value))
watch(keys, values => { for (const key of values) limits[key] ??= { mode: '', value: '' } }, { immediate: true })
watch(() => draft.catalog_version, () => { draft.catalog_tier = '' })
const serialized = () => JSON.stringify({ draft, limits })
const baseline = ref(serialized()); const attempted = ref(false)
const dirty = computed(() => serialized() !== baseline.value)
watch(() => props.resetKey, () => { baseline.value = serialized(); attempted.value = false })
const errors = computed(() => {
  const result: Record<string, string> = {}
  if (!draft.name.trim()) result.name = t('vendor.packages.required')
  if (!draft.description.trim()) result.description = t('vendor.packages.required')
  if (!source.value) result.catalog_version = t('vendor.packages.required')
  if (!tier.value) result.catalog_tier = t('vendor.packages.required')
  for (const key of keys.value) { try { packageLimitValue(limits[key]!) } catch { result[key] = t('vendor.packages.invalidLimit') } }
  return result
})
function submit() {
  if (!hydrated.value || props.busy) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  emit('save', packageFormInput(draft, limits, keys.value))
}
</script>
<template>
  <form class="space-y-6" novalidate @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <UAlert v-if="error" color="error" variant="subtle" :title="t(packageErrorKey(error))" />
    <SharedFormSection :title="t('vendor.packages.identity')">
      <UFormField :label="t('vendor.packages.name')" required :error="attempted ? errors.name : undefined"><UInput v-model="draft.name" maxlength="200" class="w-full" :disabled="!hydrated || busy" /></UFormField>
      <UFormField :label="t('vendor.packages.descriptionField')" required :error="attempted ? errors.description : undefined"><UTextarea v-model="draft.description" maxlength="2000" class="w-full" :disabled="!hydrated || busy" /></UFormField>
    </SharedFormSection>
    <SharedFormSection :title="t('vendor.packages.composition')" :description="t('vendor.packages.compositionHint')">
      <UFormField :label="t('vendor.packages.source')" required :error="attempted ? errors.catalog_version : undefined"><USelect v-model="draft.catalog_version" :items="catalogs.map(item => ({ label: item.version, value: item.version }))" class="w-full" :disabled="!hydrated || busy" /></UFormField>
      <UFormField :label="t('vendor.packages.composition')" required :error="attempted ? errors.catalog_tier : undefined"><USelect v-model="draft.catalog_tier" :items="(source?.solution.tiers ?? []).filter(item => item.id).map(item => ({ label: packageLabel('tier', item.id!, t), value: item.id! }))" :disabled="!hydrated || busy || !source" class="w-full" /></UFormField>
      <div v-if="tier" class="space-y-2"><p class="text-sm font-medium">{{ t('vendor.packages.included') }}</p><div class="flex flex-wrap gap-2"><UBadge v-for="module in [...(source?.solution.base_modules ?? []), ...(tier.modules ?? [])]" :key="module" color="neutral" variant="subtle">{{ packageLabel('module', module, t) }}</UBadge><UBadge v-for="feature in (tier.features ?? []).filter(value => value.startsWith('boolean:'))" :key="feature" color="neutral" variant="subtle">{{ packageLabel('feature', feature, t) }}</UBadge></div></div>
    </SharedFormSection>
    <SharedFormSection :title="t('vendor.packages.quotas')" :description="t('vendor.packages.quotaHint')">
      <UAlert color="neutral" variant="subtle" :title="t('vendor.packages.adminHint')" />
      <UFormField v-for="key in keys" :key="key" :label="packageLabel('limit', key, t)" required :help="key === 'storage.limit_mb' ? t('vendor.packages.storageHint') : undefined" :error="attempted ? errors[key] : undefined">
        <div class="flex flex-wrap gap-2"><USelect v-model="limits[key]!.mode" :items="[{ label: t('vendor.packages.limited'), value: 'limited' }, { label: t('vendor.common.unlimited'), value: 'unlimited' }]" :disabled="!hydrated || busy" :aria-label="packageLabel('limit', key, t)" /><UInput v-if="limits[key]!.mode === 'limited'" v-model="limits[key]!.value" inputmode="numeric" :aria-label="packageLabel('limit', key, t)" :disabled="!hydrated || busy" /></div>
        <p v-if="limits[key]!.mode === 'limited' && limits[key]!.value.trim() === '0'" class="mt-1 text-sm text-warning">{{ t('vendor.packages.zeroHint') }}</p>
      </UFormField>
    </SharedFormSection>
    <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" :disabled="!hydrated || busy" @click="emit('cancel')">{{ t('app.cancel') }}</UButton><UButton type="submit" :loading="busy" :disabled="!hydrated || busy">{{ t('vendor.packages.saveDraft') }}</UButton></div>
  </form>
</template>
