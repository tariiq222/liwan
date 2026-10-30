<script setup lang="ts">
import { WORK_KINDS, workCountLabel } from '@/composables/nav/attentionModel'
import { useMyWork } from '@/composables/useMyWork'

// Three personal counts (to do, to decide, to follow) from the same rows «مهامي» lists; each tile opens that tab. Hidden
// when the user cannot open «مهامي» or no application has anything to say to them. Until the rows arrive (or if all fail)
// a tile shows no figure rather than a wrong zero.
const { t } = useI18n()
const { available, grouped, pending, failed, cappedKinds } = useMyWork()
const ICONS = { execute: 'i-lucide-list-checks', decide: 'i-lucide-gavel', follow: 'i-lucide-eye' } as const
const tiles = computed(() => WORK_KINDS.map(kind => ({
  kind,
  label: t(`home.indicator.${kind}`),
  value: pending.value || failed.value ? null : workCountLabel(grouped.value[kind].length, cappedKinds.value.includes(kind)),
  icon: ICONS[kind],
  to: `/work?tab=${kind}`,
})))
</script>

<template>
  <section v-if="available" :aria-label="t('home.indicators')" class="grid gap-(--liwan-gap-card) sm:grid-cols-3" data-testid="home-indicators">
    <SharedMetricTile v-for="tile in tiles" :key="tile.kind" :label="tile.label" :value="tile.value" :icon="tile.icon" :to="tile.to" density="compact" value-dir="ltr" :data-testid="`home-indicator-${tile.kind}`" />
  </section>
</template>
