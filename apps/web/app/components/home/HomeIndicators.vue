<script setup lang="ts">
import { WORK_KINDS, workCountLabel } from '@/composables/nav/attentionModel'
import { useMyWork } from '@/composables/useMyWork'

// Three personal counts (to do, to decide, to follow) from the same rows «مهامي» lists; each card opens that tab. Hidden
// when the user cannot open «مهامي» or no application has anything to say to them. Until the rows arrive (or if all fail)
// a card shows a dash rather than a wrong zero.
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
  <section v-if="available" :aria-label="t('home.indicators')" class="grid grid-cols-3 gap-4 max-md:gap-2" data-testid="home-indicators">
    <NuxtLink
      v-for="tile in tiles"
      :key="tile.kind"
      :to="tile.to"
      :data-testid="`home-indicator-${tile.kind}`"
      class="group flex items-center gap-4 rounded-card border-[1.5px] border-default bg-default px-5 py-5 transition duration-200 hover:-translate-y-0.5 hover:border-accented hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0 max-md:flex-col max-md:items-start max-md:gap-2 max-md:p-3"
    >
      <div>
        <b class="block font-display text-4xl font-bold leading-none tracking-tight tabular-nums text-highlighted max-md:text-3xl" dir="ltr">{{ tile.value ?? '—' }}</b>
        <span class="mt-1 block text-sm text-muted">{{ tile.label }}</span>
      </div>
      <span class="liwan-app-tile ms-auto size-9 max-md:order-first max-md:ms-0" aria-hidden="true"><UIcon :name="tile.icon" class="size-4.5" /></span>
    </NuxtLink>
  </section>
</template>
