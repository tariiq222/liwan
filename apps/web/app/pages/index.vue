<script setup lang="ts">
import HomeApps from '@/components/home/HomeApps.vue'
import HomeAssistantBanner from '@/components/home/HomeAssistantBanner.vue'
import HomeFocus from '@/components/home/HomeFocus.vue'
import HomeGreeting from '@/components/home/HomeGreeting.vue'
import HomeIndicators from '@/components/home/HomeIndicators.vue'
import { useAppCards } from '@/composables/useAppCards'
import { postLoginPath } from '@/utils/accessPolicy'

// «يومي»: the greeting, the assistant banner, the three personal counts, what to start with, then every application.
const { t } = useI18n()
const { me, ready } = useMe()
await ready
if (!Array.isArray(me.value?.capabilities)) await navigateTo(postLoginPath(me.value, undefined))
usePageHeader(() => t('nav.home'))
const { cards } = useAppCards({ assistant: false })
</script>

<template>
  <SharedPageContainer data-testid="foundation-home">
    <HomeGreeting />
    <HomeAssistantBanner />
    <HomeIndicators />
    <HomeFocus />
    <HomeApps v-if="cards.length" :cards="cards" />
    <SharedEmptyState v-else bordered :title="t('home.empty')" data-testid="home-empty-no-apps">
      <template #action><UButton to="/account" color="neutral" variant="outline" :label="t('nav.account')" /></template>
    </SharedEmptyState>
  </SharedPageContainer>
</template>
