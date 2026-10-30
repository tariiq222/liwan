<script setup lang="ts">
import { visibleSettingsPages } from '@/composables/nav/shellModules'

// The settings overview: one card per page the user can reach, listing the cards inside it.
const { t } = useI18n()
const { me, ready } = useMe()
await ready
const cards = computed(() => visibleSettingsPages(me.value).map(({ page, parts }) => ({
  id: page.id,
  to: parts[0]!.to ?? page.to,
  icon: page.icon,
  title: t(page.labelKey),
  description: parts.map(part => t(part.labelKey)).join(t('settings.overview.separator')),
})))
</script>

<template>
  <SharedSettingsPage data-testid="settings-overview">
    <SharedPageHeader :title="t('settings.title')" />
    <section v-if="cards.length" :aria-label="t('settings.title')" class="grid gap-(--liwan-gap-card) sm:grid-cols-2 xl:grid-cols-3">
      <SharedLinkCard v-for="card in cards" :key="card.id" :to="card.to" :icon="card.icon" :title="card.title" :description="card.description" :data-testid="`settings-section-${card.id}`" />
    </section>
    <SharedEmptyState v-else bordered :title="t('settings.forbidden')" />
  </SharedSettingsPage>
</template>
