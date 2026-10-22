<script setup lang="ts">
import { useNav } from '@/composables/nav/shellModules'
import { visibleCommands } from '@/composables/nav/paletteModel'
import { postLoginPath } from '@/utils/accessPolicy'
const { t, te } = useI18n()
const { me, ready } = useMe()
await ready
if (!Array.isArray(me.value?.capabilities)) await navigateTo(postLoginPath(me.value, undefined))
const destinations = computed(() => useNav(me.value).filter(item => item.to !== '/'))
const actions = computed(() => visibleCommands(me.value))

// One line per destination, taken from the description its own page already shows; a destination without one is a title-only tile.
const DESCRIPTION_KEYS: Record<string, string> = {
  '/projects': 'projects.description',
  '/tasks': 'tasks.description',
  '/my-tasks': 'myTasks.description',
  '/ai': 'ai.description',
  '/chat': 'chat.description',
  '/hr': 'hr.directory.description',
  '/hr/departments': 'hr.depts.pageDescription',
  '/documents': 'documents.description',
  '/meetings/follow-up': 'meetingsUx.followupDescription',
}
const describe = (to: string) => {
  const key = DESCRIPTION_KEYS[to]
  return key && te(key) ? t(key) : undefined
}
</script>

<template>
  <SharedPageContainer width="list" data-testid="foundation-home">
    <SharedPageHeader :title="t('nav.home')" />
    <HomeAssistantSuggestions />
    <section v-if="destinations.length" :aria-label="t('nav.goTo')" class="grid gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-3">
      <SharedLinkCard v-for="item in destinations" :key="item.to" :to="item.to" :icon="item.icon" :title="t(item.labelKey)" :description="describe(item.to)" />
    </section>
    <section v-if="actions.length" :aria-label="t('app.actions')" class="space-y-3">
      <h2 class="text-sm font-semibold text-muted">{{ t('app.actions') }}</h2>
      <div class="flex flex-wrap gap-2">
        <UButton v-for="action in actions" :key="action.id" :to="{ path: action.to, query: { returnTo: '/' } }" color="neutral" variant="soft" size="sm" class="rounded-full">
          <span class="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true"><UIcon name="i-lucide-plus" class="size-3.5" /></span>
          {{ t(action.labelKey) }}
        </UButton>
      </div>
    </section>
    <SharedEmptyState v-if="!destinations.length && !actions.length" bordered :title="t('home.empty')">
      <template #action><UButton to="/account" color="neutral" variant="outline" class="rounded-full" :label="t('nav.account')" /></template>
    </SharedEmptyState>
  </SharedPageContainer>
</template>
