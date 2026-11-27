<script setup lang="ts">
import HomeHello from '@/components/home/HomeHello.vue'
import HomeSection from '@/components/home/HomeSection.vue'
import LauncherAddonRow from '@/components/launcher/LauncherAddonRow.vue'
import LauncherRow from '@/components/launcher/LauncherRow.vue'
import { useAppCards } from '@/composables/useAppCards'
import { useAvailableAddons } from '@/composables/useAvailableAddons'
import { useRailPins } from '@/composables/useRailPins'

// Every application the user may open, in two groups: the ones included with the platform and the specialised add-ons.
// In SaaS, authorised readers also see sellable add-ons not yet owned from the live commercial catalog.
// Pinning puts an application in the sidebar; search is the global palette's job.
const { t, te } = useI18n()
usePageHeader(() => t('launcher.title'))
const { cards } = useAppCards({ assistant: true })
const { addons: availableAddons, planOverrides, canManage } = useAvailableAddons()
const { pins, toggle } = useRailPins(() => cards.value.filter(card => card.pinnable).map(card => card.id))
const hydrated = useHydrated()
const classifiedCards = computed(() => cards.value.map(card => {
  const plan = planOverrides.value.get(card.id) ?? card.plan
  return plan === card.plan ? card : { ...card, plan }
}))
const groups = computed(() => (['included', 'addon'] as const)
  .map(plan => ({ plan, cards: classifiedCards.value.filter(card => card.plan === plan) }))
  .filter(group => group.cards.length > 0))
const descriptionOf = (id: string) => (te(`launcher.apps.${id}.description`) ? t(`launcher.apps.${id}.description`) : undefined)
</script>

<template>
  <SharedPageContainer data-testid="apps-page">
    <HomeHello :title="t('launcher.title')">{{ t('launcher.subtitle') }}</HomeHello>
    <SharedEmptyState icon="i-lucide-layout-grid" v-if="!cards.length && !availableAddons.length" bordered :title="t('home.empty')" data-testid="apps-empty" />
    <HomeSection v-for="group in groups" :key="group.plan" mark="diamond" :title="t(`launcher.${group.plan}.title`)" :subtitle="t(`launcher.${group.plan}.subtitle`)" :data-testid="`apps-${group.plan}`">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-3.5">
        <LauncherRow
          v-for="card in group.cards"
          :key="card.id"
          :card="card"
          :description="descriptionOf(card.id)"
          :pinned="pins.includes(card.id)"
          :pin-pending="!hydrated"
          @toggle-pin="toggle(card.id)"
        />
      </div>
    </HomeSection>
    <HomeSection v-if="availableAddons.length" mark="diamond" :title="t('launcher.available.title')" :subtitle="t('launcher.available.subtitle')" data-testid="apps-available">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-3.5">
        <LauncherAddonRow
          v-for="addon in availableAddons"
          :key="addon.bundleId"
          :addon="addon"
          :can-manage="canManage"
          :action-pending="!hydrated"
        />
      </div>
    </HomeSection>
  </SharedPageContainer>
</template>
