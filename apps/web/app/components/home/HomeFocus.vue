<script setup lang="ts">
import WorkRow from '@/components/work/WorkRow.vue'
import { useModuleLabel } from '@/composables/useModuleLabel'
import { useMyWork } from '@/composables/useMyWork'

// «ابدأ بالأهم»: the first rows of the user's work (urgent first), with a link to the whole list. Hidden with the rest of the
// personal surfaces when the user has no work page; an empty list says so instead of drawing an empty card.
const FOCUS_ROWS = 3
const { t } = useI18n()
const sourceLabel = useModuleLabel()
const { available, rows, pending, failed, refetch } = useMyWork()
const top = computed(() => rows.value.slice(0, FOCUS_ROWS))
</script>

<template>
  <section v-if="available" :aria-label="t('home.focus')" class="overflow-hidden rounded-card bg-default ring ring-default" data-testid="home-focus">
    <div class="flex items-center justify-between gap-3 border-b border-default px-(--liwan-card-pad-dense) py-3">
      <h2 class="text-sm font-semibold text-highlighted">{{ t('home.focus') }}</h2>
      <UButton to="/work" color="neutral" variant="ghost" size="xs" class="rounded-full" :label="t('home.viewAll')" data-testid="home-focus-all" />
    </div>
    <SharedLoadingSkeleton v-if="pending" />
    <SharedErrorState v-else-if="failed" data-testid="home-focus-error" @retry="refetch()" />
    <p v-else-if="!top.length" class="px-(--liwan-card-pad-dense) py-4 text-sm text-muted" data-testid="home-focus-empty">{{ t('home.focusEmpty') }}</p>
    <ul v-else class="divide-y divide-default" data-testid="home-focus-list">
      <WorkRow v-for="row in top" :key="row.id" :row="row" :source-label="sourceLabel(row.module)" />
    </ul>
  </section>
</template>
