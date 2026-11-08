<script setup lang="ts">
import HomeAppCard from '@/components/home/HomeAppCard.vue'
import HomeRail from '@/components/home/HomeRail.vue'
import HomeSection from '@/components/home/HomeSection.vue'
import { filterAppCards, presentCategories, type AppCardFilter, type AppCardModel } from '@/composables/useAppCards'

// «تطبيقاتك»: every application the user may open as a gradient card on a snapping rail, with chips that keep one category.
// The chips appear only when more than one category is present. Nothing to show renders nothing, not an empty section.
const props = defineProps<{ cards: readonly AppCardModel[] }>()
const { t, te } = useI18n()
const filter = ref<AppCardFilter>('all')
const categories = computed(() => presentCategories(props.cards))
const shown = computed(() => filterAppCards(props.cards, filter.value))
const descriptionOf = (id: string) => (te(`launcher.apps.${id}.description`) ? t(`launcher.apps.${id}.description`) : undefined)
const CHIP = 'inline-flex h-9 items-center rounded-chip px-4 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
</script>

<template>
  <HomeSection v-if="props.cards.length" id="apps" mark="diamond" :title="t('home.apps')" :subtitle="t('home.appsSubtitle')" data-testid="home-apps">
    <template v-if="categories.length > 1" #actions>
      <div class="flex flex-wrap gap-2.5" role="group" :aria-label="t('home.filter.label')" data-testid="home-apps-filter">
        <button v-for="option in (['all', ...categories] as AppCardFilter[])" :key="option" type="button" :aria-pressed="filter === option" :class="[CHIP, filter === option ? 'bg-inverted text-inverted' : 'bg-muted text-default hover:bg-elevated']" :data-testid="`home-apps-filter-${option}`" @click="filter = option">{{ t(`home.filter.${option}`) }}</button>
      </div>
    </template>
    <HomeRail :label="t('home.apps')" data-testid="home-apps-list">
      <HomeAppCard v-for="card in shown" :key="card.id" :card="card" :description="descriptionOf(card.id)" />
    </HomeRail>
  </HomeSection>
</template>
