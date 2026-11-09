<script setup lang="ts">
import HomeHello from '@/components/home/HomeHello.vue'
import HomeSection from '@/components/home/HomeSection.vue'
import LauncherRow from '@/components/launcher/LauncherRow.vue'
import { MAX_RAIL_PINS } from '@/composables/nav/railPins'
import { useAppCards } from '@/composables/useAppCards'
import { useRailPins } from '@/composables/useRailPins'

// Every application the user may open, in two groups: the ones included with the platform and the specialised add-ons.
// Pinning puts an application in the sidebar (up to the pin limit); search is the global palette's job.
const { t, te } = useI18n()
usePageHeader(() => t('launcher.title'))
const { cards } = useAppCards({ assistant: true })
const { pins, atLimit, toggle } = useRailPins(() => cards.value.filter(card => card.pinnable).map(card => card.id))
const hydrated = useHydrated()
const groups = computed(() => (['included', 'addon'] as const)
  .map(plan => ({ plan, cards: cards.value.filter(card => card.plan === plan) }))
  .filter(group => group.cards.length > 0))
const descriptionOf = (id: string) => (te(`launcher.apps.${id}.description`) ? t(`launcher.apps.${id}.description`) : undefined)
</script>

<template>
  <SharedPageContainer data-testid="apps-page">
    <HomeHello :title="t('launcher.title')">{{ t('launcher.subtitle', { count: MAX_RAIL_PINS }) }}</HomeHello>
    <SharedEmptyState v-if="!cards.length" bordered :title="t('home.empty')" data-testid="apps-empty" />
    <HomeSection v-for="group in groups" :key="group.plan" mark="diamond" :title="t(`launcher.${group.plan}.title`)" :subtitle="t(`launcher.${group.plan}.subtitle`)" :data-testid="`apps-${group.plan}`">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-3.5">
        <LauncherRow
          v-for="card in group.cards"
          :key="card.id"
          :card="card"
          :description="descriptionOf(card.id)"
          :pinned="pins.includes(card.id)"
          :pin-disabled="!hydrated || (atLimit && !pins.includes(card.id))"
          @toggle-pin="toggle(card.id)"
        />
      </div>
    </HomeSection>
  </SharedPageContainer>
</template>
