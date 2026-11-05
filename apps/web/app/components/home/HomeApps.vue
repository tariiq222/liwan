<script setup lang="ts">
import LauncherCard from '@/components/launcher/LauncherCard.vue'
import { launcherEntries } from '@/composables/nav/launcherModel'

// Every application the user may open, on «يومي» itself: one card per application with its own start actions and its
// rail pin. Search is the global palette's job, so the section carries no search box, and an application the base
// system keeps in the rail (the assistant) is never a card. Nothing to show renders nothing, not an empty section.
const { t, te } = useI18n()
const { me } = useMe()
const entries = computed(() => launcherEntries(me.value, '', t))
const { pins, atLimit, toggle } = useShellModel().railPins
const hydrated = useHydrated()
const descriptionOf = (id: string) => (te(`launcher.apps.${id}.description`) ? t(`launcher.apps.${id}.description`) : undefined)
</script>

<template>
  <section v-if="entries.length" id="apps" class="space-y-3" aria-labelledby="apps-title" data-testid="home-apps">
    <h2 id="apps-title" class="text-sm font-semibold text-muted">{{ t('home.apps') }}</h2>
    <div class="liwan-card-grid">
      <LauncherCard
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        :description="descriptionOf(entry.id)"
        :pinned="pins.includes(entry.id)"
        :pin-disabled="!hydrated || (atLimit && !pins.includes(entry.id))"
        @toggle-pin="toggle(entry.id)"
      />
    </div>
  </section>
</template>
