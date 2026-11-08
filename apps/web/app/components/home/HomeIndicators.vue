<script setup lang="ts">
import { WORK_KINDS, workCountLabel } from '@/composables/nav/attentionModel'
import { useMyWork } from '@/composables/useMyWork'

// Three personal counts (to do, to decide, to follow) from the same rows «مهامي» lists; each card opens that tab. Hidden
// when the user cannot open «مهامي» or no application has anything to say to them. While the rows load a card shows a
// skeleton bar in the figure's place; if all providers failed it shows a dash. Neither is ever a wrong zero.
const { t } = useI18n()
const { available, grouped, pending, failed, cappedKinds } = useMyWork()
const ICONS = { execute: 'i-lucide-list-checks', decide: 'i-lucide-gavel', follow: 'i-lucide-eye' } as const
const tiles = computed(() => WORK_KINDS.map(kind => ({
  kind,
  label: t(`home.indicator.${kind}`),
  value: pending.value || failed.value ? null : workCountLabel(grouped.value[kind].length, cappedKinds.value.includes(kind)),
  loading: pending.value,
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
      class="liwan-lift flex items-center gap-4 rounded-card border-[1.5px] border-default bg-default px-5 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-md:flex-col max-md:items-start max-md:gap-2 max-md:p-3"
    >
      <div>
        <USkeleton v-if="tile.loading" class="h-9 w-12 max-md:h-[1.875rem]" data-slot="indicator-skeleton" />
        <b v-else class="liwan-soft-in block font-display text-4xl font-bold leading-none tracking-tight tabular-nums text-highlighted max-md:text-3xl" dir="ltr">{{ tile.value ?? '—' }}</b>
        <span class="mt-1 block text-sm text-muted">{{ tile.label }}</span>
      </div>
      <span class="liwan-app-tile ms-auto size-9 max-md:order-first max-md:ms-0" aria-hidden="true"><UIcon :name="tile.icon" class="size-4.5" /></span>
    </NuxtLink>
  </section>
</template>
