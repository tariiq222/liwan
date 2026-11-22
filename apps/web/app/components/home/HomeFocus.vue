<script setup lang="ts">
import HomeFocusCard from '@/components/home/HomeFocusCard.vue'
import HomeFocusSkeleton from '@/components/home/HomeFocusSkeleton.vue'
import HomeSection from '@/components/home/HomeSection.vue'
import { shellModuleList } from '@/composables/nav/shellModules'
import { useMyWork } from '@/composables/useMyWork'

// «ابدأ بالأهم»: the person's work, urgent first, as a short list of rows from every application in one card, with a link
// to the whole list. Hidden with the rest of the personal surfaces when the user has no work page; an empty list says so
// instead of drawing an empty card.
const FOCUS_ROWS = 5
const { t } = useI18n()
const { available, rows, settled, failed, refetch } = useMyWork()
const modules = new Map(shellModuleList().map(module => [module.id, module]))
const items = computed(() => rows.value.slice(0, FOCUS_ROWS).map(row => {
  const module = modules.get(row.module)
  return { row, label: module ? t(module.labelKey) : row.module, icon: module?.icon }
}))
</script>

<template>
  <HomeSection v-if="available" mark="triangle" :title="t('home.focus')" :subtitle="t('home.focusSubtitle')" data-testid="home-focus">
    <template #actions>
      <UButton to="/work" color="neutral" variant="link" size="sm" :label="t('home.viewAll')" data-testid="home-focus-all" />
    </template>
    <!-- Progressive: the list appears as soon as one application answers, instead of waiting for the slowest one
         (which froze the greeting and the whole page behind it). The skeleton shows only before the first answer. -->
    <HomeFocusSkeleton v-if="!settled" />
    <SharedErrorState v-else-if="failed" data-testid="home-focus-error" @retry="refetch()" />
    <p v-else-if="!items.length" class="rounded-card border-[1.5px] border-dashed border-default p-5 text-sm text-muted" data-testid="home-focus-empty">{{ t('home.focusEmpty') }}</p>
    <ul v-else :aria-label="t('home.focus')" class="liwan-soft-in divide-y divide-default overflow-hidden rounded-card border-[1.5px] border-default bg-default" data-testid="home-focus-list">
      <HomeFocusCard v-for="item in items" :key="item.row.id" :row="item.row" :app-label="item.label" :app-icon="item.icon" />
    </ul>
  </HomeSection>
</template>
