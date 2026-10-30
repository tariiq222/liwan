<script setup lang="ts">
import type { KpiTile } from '../../../utils/kpiTile'

// The row of metric tiles above a main or list page: compact `SharedMetricTile`s, four to a row from `lg`, two on a phone.
// Tiles are information, never buttons (a tile with `to` is a link). While `loading` the row is skeletons of the same size, so the
// page does not jump. The whole strip is absent when the user turned KPIs off (`useKpiVisibility`, toggled from the page header).
const props = withDefaults(defineProps<{
  tiles?: readonly KpiTile[]
  loading?: boolean
  /** Skeleton count while loading; defaults to the number of tiles, or 4 without any. */
  skeletonCount?: number
  /** The region's accessible name; defaults to "Key figures". */
  label?: string
}>(), { tiles: () => [] })
const { t } = useI18n()
const { shown } = useKpiVisibility()
const skeletons = computed(() => props.skeletonCount ?? (props.tiles.length || 4))
</script>

<template>
  <section v-if="shown" data-slot="kpi-strip" class="grid grid-cols-2 gap-(--liwan-gap-card) lg:grid-cols-4" :aria-label="props.label ?? t('states.metrics')">
    <template v-if="!props.loading">
      <SharedMetricTile
        v-for="tile in props.tiles"
        :key="tile.id"
        density="compact"
        :tone="tile.tone"
        :icon="tile.icon"
        :label="tile.label"
        :value="tile.value"
        :hint="tile.hint"
        :progress="tile.progress"
        :to="tile.to"
        value-dir="ltr"
      />
    </template>
    <template v-else>
      <USkeleton v-for="n in skeletons" :key="n" class="h-[4.5rem] rounded-card" />
    </template>
  </section>
</template>
