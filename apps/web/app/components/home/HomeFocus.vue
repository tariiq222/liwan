<script setup lang="ts">
import HomeFocusCard from '@/components/home/HomeFocusCard.vue'
import HomeRail from '@/components/home/HomeRail.vue'
import HomeSection from '@/components/home/HomeSection.vue'
import { shellModuleList } from '@/composables/nav/shellModules'
import { useMyWork } from '@/composables/useMyWork'

// «ابدأ بالأهم»: the person's work, urgent first, as a snapping rail of cards from every application, with arrows and a link
// to the whole list. Hidden with the rest of the personal surfaces when the user has no work page; an empty list says so
// instead of drawing an empty rail.
const FOCUS_CARDS = 12
const { t } = useI18n()
const { available, rows, pending, failed, refetch } = useMyWork()
const modules = new Map(shellModuleList().map(module => [module.id, module]))
const cards = computed(() => rows.value.slice(0, FOCUS_CARDS).map(row => {
  const module = modules.get(row.module)
  return { row, label: module ? t(module.labelKey) : row.module, icon: module?.icon }
}))
const rail = ref<InstanceType<typeof HomeRail> | null>(null)
</script>

<template>
  <HomeSection v-if="available" mark="triangle" :title="t('home.focus')" :subtitle="t('home.focusSubtitle')" data-testid="home-focus">
    <template #actions>
      <div class="flex items-center gap-2">
        <UButton to="/work" color="neutral" variant="link" size="sm" :label="t('home.viewAll')" data-testid="home-focus-all" />
        <UButton type="button" square color="neutral" variant="soft" icon="i-lucide-chevron-left" class="rtl:rotate-180" :aria-label="t('home.rail.previous')" data-testid="home-focus-previous" @click="rail?.scrollCards(-1)" />
        <UButton type="button" square color="neutral" variant="soft" icon="i-lucide-chevron-right" class="rtl:rotate-180" :aria-label="t('home.rail.next')" data-testid="home-focus-next" @click="rail?.scrollCards(1)" />
      </div>
    </template>
    <SharedLoadingSkeleton v-if="pending" />
    <SharedErrorState v-else-if="failed" data-testid="home-focus-error" @retry="refetch()" />
    <p v-else-if="!cards.length" class="rounded-card border-[1.5px] border-dashed border-default p-5 text-sm text-muted" data-testid="home-focus-empty">{{ t('home.focusEmpty') }}</p>
    <HomeRail v-else ref="rail" :label="t('home.focus')" data-testid="home-focus-list">
      <HomeFocusCard v-for="card in cards" :key="card.row.id" :row="card.row" :app-label="card.label" :app-icon="card.icon" />
    </HomeRail>
  </HomeSection>
</template>
