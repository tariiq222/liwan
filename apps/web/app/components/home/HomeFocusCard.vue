<script setup lang="ts">
import type { AttentionRowWithModule } from '@/composables/nav/attentionModel'

// One thing that needs the person, as a row of the «ابدأ بالأهم» list: its application, the title (the whole row opens
// it), a caption, a pill saying how urgent it is and what opening it asks of them.
const props = defineProps<{ row: AttentionRowWithModule; appLabel: string; appIcon?: string }>()
const { t } = useI18n()
const urgent = computed(() => props.row.tone === 'urgent')
// The chip says how close the deadline is when the row has one (overdue and today are drawn red, later is neutral); a row
// without a deadline keeps the old chip: «urgent» when it waits on the person, else the kind of work.
const chip = computed(() => {
  const due = props.row.due
  if (due) return { color: due === 'soon' ? 'neutral' as const : 'error' as const, label: t(`home.due.${due}`) }
  return { color: urgent.value ? 'warning' as const : 'neutral' as const, label: urgent.value ? t('home.focusUrgent') : t(`home.indicator.${props.row.work}`) }
})
</script>

<template>
  <li :data-app="props.row.module" data-testid="home-focus-card" class="relative flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-(--liwan-row-hover) has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-primary">
    <span class="liwan-app-tile liwan-app-tile-md shrink-0" aria-hidden="true"><UIcon :name="props.appIcon ?? 'i-lucide-circle'" class="size-4.5" /></span>
    <div class="min-w-0 flex-1">
      <h3 class="line-clamp-2 text-base font-semibold leading-snug text-highlighted sm:truncate sm:line-clamp-none">
        <NuxtLink :to="props.row.to" class="after:absolute after:inset-0 focus-visible:outline-none" data-testid="home-focus-link">{{ props.row.label }}</NuxtLink>
      </h3>
      <p class="truncate text-xs text-muted"><small>{{ props.appLabel }}</small><template v-if="props.row.caption"> · {{ props.row.caption }}</template></p>
    </div>
    <UBadge :color="chip.color" variant="soft" :label="chip.label" class="shrink-0" data-testid="home-focus-chip" />
    <span class="hidden h-8 shrink-0 items-center rounded-control bg-muted px-3.5 text-sm font-medium text-default sm:inline-flex" aria-hidden="true">{{ t(`home.focusAction.${props.row.work}`) }}</span>
  </li>
</template>
