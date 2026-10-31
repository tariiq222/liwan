<script setup lang="ts">
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import LauncherCard from '@/components/launcher/LauncherCard.vue'
import { launcherEntries } from '@/composables/nav/launcherModel'

// Existing application actions are filtered by the same permissions as their destination pages.
const { t, te } = useI18n()
const { me, ready } = useMe()
await ready
const hydrated = useHydrated()
const query = ref('')
const entries = computed(() => launcherEntries(me.value, query.value, t))
const { pins, atLimit, toggle } = useShellModel().railPins
const descriptionOf = (id: string) => (te(`launcher.apps.${id}.description`) ? t(`launcher.apps.${id}.description`) : undefined)
</script>

<template>
  <SharedPageContainer width="list" data-testid="launcher-page">
    <SharedPageHeader :title="t('launcher.title')" />
    <p class="-mt-2 text-sm text-muted">{{ t('launcher.description') }}</p>
    <FilterBar embedded :active-count="query.trim() ? 1 : 0" :disabled="!hydrated" @clear="query = ''">
      <template #search>
        <UInput v-model="query" :disabled="!hydrated" type="search" icon="i-lucide-search" class="min-w-48 flex-1" data-testid="launcher-search" :aria-label="t('launcher.search')" :placeholder="t('launcher.search')" />
      </template>
    </FilterBar>
    <section v-if="entries.length" :aria-label="t('launcher.title')" class="grid gap-(--liwan-gap-card) sm:grid-cols-2 xl:grid-cols-3">
      <LauncherCard
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        :description="descriptionOf(entry.id)"
        :pinned="pins.includes(entry.id)"
        :pin-disabled="!hydrated || (atLimit && !pins.includes(entry.id))"
        @toggle-pin="toggle(entry.id)"
      />
    </section>
    <SharedEmptyState v-else bordered :title="query.trim() ? t('launcher.noResults') : t('launcher.empty')" />
  </SharedPageContainer>
</template>
