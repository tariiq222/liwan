<script setup lang="ts">
import { visibleSettingsSections } from '@/composables/nav/shellModules'

// The settings overview: one card per section the user can reach, listing the pages inside it.
const { t } = useI18n()
const { me, ready } = useMe()
await ready
const cards = computed(() => visibleSettingsSections(me.value).map(({ section, entries }) => ({
  id: section.id,
  to: entries[0]!.to,
  icon: section.icon,
  title: t(section.labelKey),
  description: entries.map(entry => t(entry.labelKey)).join(t('settings.overview.separator')),
})))
</script>

<template>
  <SharedSettingsPage data-testid="settings-overview">
    <SharedPageHeader :title="t('settings.title')" />
    <section v-if="cards.length" :aria-label="t('settings.title')" class="grid gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-3">
      <SharedLinkCard v-for="card in cards" :key="card.id" :to="card.to" :icon="card.icon" :title="card.title" :description="card.description" :data-testid="`settings-section-${card.id}`" />
    </section>
    <SharedEmptyState v-else bordered :title="t('settings.forbidden')" />
  </SharedSettingsPage>
</template>
