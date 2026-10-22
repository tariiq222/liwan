<script setup lang="ts">
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import LauncherCard from '@/components/launcher/LauncherCard.vue'
import { launcherEntries } from '@/composables/nav/launcherModel'
import { visibleShellModules } from '@/composables/nav/shellModules'
import { useAppPins } from '@/composables/useAppPins'

// The launcher: every application the signed-in user can reach, from the same modules the rail is built from, so
// permissions and features are respected. Pinning puts an application in the rail; the rail never loses a page.
const { t, te } = useI18n()
const { me, ready } = useMe()
await ready
const hydrated = useHydrated()
const { pinned, toggle, move } = useAppPins()
const query = ref('')
const entries = computed(() => launcherEntries(visibleShellModules(me.value), pinned.value, query.value, t))
const visiblePins = computed(() => entries.value.filter(entry => entry.pinned).map(entry => entry.id))
// The order buttons act on the pinned cards on show, and the new place is announced (the focus stays on the button).
const announcement = ref('')
function moveCard(id: string, delta: -1 | 1) {
  const among = visiblePins.value
  move(id, delta, among)
  announcement.value = t('launcher.moved', { name: t(entries.value.find(entry => entry.id === id)?.labelKey ?? id), position: among.indexOf(id) + delta + 1, count: among.length })
}
const descriptionOf = (id: string) => (te(`launcher.apps.${id}.description`) ? t(`launcher.apps.${id}.description`) : undefined)
</script>

<template>
  <SharedPageContainer width="list" data-testid="launcher-page">
    <SharedPageHeader :title="t('launcher.title')" />
    <p class="-mt-2 text-sm text-muted">{{ t('launcher.description') }}</p>
    <FilterBar embedded :active-count="query.trim() ? 1 : 0" :disabled="!hydrated" @clear="query = ''">
      <template #search>
        <UInput v-model="query" type="search" icon="i-lucide-search" class="min-w-48 flex-1" data-testid="launcher-search" :aria-label="t('launcher.search')" :placeholder="t('launcher.search')" />
      </template>
    </FilterBar>
    <p class="sr-only" role="status" aria-live="polite" data-testid="launcher-announcement">{{ announcement }}</p>
    <section v-if="entries.length" :aria-label="t('launcher.title')" class="grid gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-3">
      <LauncherCard
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        :description="descriptionOf(entry.id)"
        :pinned-count="visiblePins.length"
        :disabled="!hydrated"
        @toggle="toggle(entry.id)"
        @move="delta => moveCard(entry.id, delta)"
      />
    </section>
    <SharedEmptyState v-else bordered :title="query.trim() ? t('launcher.noResults') : t('launcher.empty')" />
  </SharedPageContainer>
</template>
