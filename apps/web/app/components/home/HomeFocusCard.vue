<script setup lang="ts">
import type { AttentionRowWithModule } from '@/composables/nav/attentionModel'

// One thing that needs the person, as a card of the «ابدأ بالأهم» rail: its application, the title (the whole card opens
// it), a caption, a pill saying how urgent it is and what opening it asks of them.
const props = defineProps<{ row: AttentionRowWithModule; appLabel: string; appIcon?: string }>()
const { t } = useI18n()
const urgent = computed(() => props.row.tone === 'urgent')
</script>

<template>
  <article :data-app="props.row.module" data-testid="home-focus-card" class="group relative flex w-[300px] flex-col gap-3.5 overflow-hidden rounded-card border-[1.5px] border-default bg-default p-5 transition duration-200 hover:-translate-y-0.5 hover:border-accented hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
    <div class="flex items-center gap-2.5">
      <span class="liwan-app-tile size-9 transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none" aria-hidden="true"><UIcon :name="props.appIcon ?? 'i-lucide-circle'" class="size-4.5" /></span>
      <small class="text-xs text-muted">{{ props.appLabel }}</small>
    </div>
    <h3 class="text-lg font-semibold leading-snug text-highlighted">
      <NuxtLink :to="props.row.to" class="break-words after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-primary" data-testid="home-focus-link">{{ props.row.label }}</NuxtLink>
    </h3>
    <p v-if="props.row.caption" class="text-sm leading-normal text-muted">{{ props.row.caption }}</p>
    <div class="mt-auto flex items-center justify-between gap-2">
      <UBadge :color="urgent ? 'warning' : 'neutral'" variant="soft" :label="urgent ? t('home.focusUrgent') : t(`home.indicator.${props.row.work}`)" />
      <span class="inline-flex h-8 items-center rounded-control bg-muted px-3.5 text-sm font-medium text-default" aria-hidden="true">{{ t(`home.focusAction.${props.row.work}`) }}</span>
    </div>
  </article>
</template>
