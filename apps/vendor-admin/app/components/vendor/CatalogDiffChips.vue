<script setup lang="ts">
import { catalogDiffSummary, type CatalogDiff } from '@/utils/catalogDiff'
// The compact change a version carries, one chip per changed family; "no change" when nothing changed and
// "first import" when there is no older version to compare with (diff null).
const props = defineProps<{ diff: CatalogDiff | null }>()
const { t } = useI18n()
const chips = computed(() => (props.diff ? catalogDiffSummary(props.diff) : null))
</script>
<template>
  <div v-if="diff" class="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="catalog-diff-chips">
    <UBadge v-for="chip in chips" :key="chip.key" color="neutral" variant="subtle" :data-testid="`catalog-diff-${chip.key}`">
      {{ t(`vendor.catalog.diff.${chip.key}`, { count: chip.count }, chip.count) }}
    </UBadge>
    <UBadge v-if="!chips?.length" color="neutral" variant="subtle" data-testid="catalog-diff-none">{{ t('vendor.catalog.diff.none') }}</UBadge>
  </div>
  <UBadge v-else color="neutral" variant="outline" data-testid="catalog-diff-first">{{ t('vendor.catalog.diff.first') }}</UBadge>
</template>
