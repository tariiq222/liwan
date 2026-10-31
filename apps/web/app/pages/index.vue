<script setup lang="ts">
import HomeFocus from '@/components/home/HomeFocus.vue'
import HomeIndicators from '@/components/home/HomeIndicators.vue'
import { reachableApplications } from '@/composables/nav/launcherModel'
import { visibleShellModules } from '@/composables/nav/shellModules'
import { HOME_QUICK_LIMIT, homeQuickActions } from '@/composables/nav/homeQuickActions'
import { visibleCommands } from '@/composables/nav/paletteModel'
import { personalEntries } from '@/composables/nav/personalModel'
import { useMyWork } from '@/composables/useMyWork'
import { postLoginPath } from '@/utils/accessPolicy'
const { t, locale } = useI18n()
const { me, ready } = useMe()
await ready
if (!Array.isArray(me.value?.capabilities)) await navigateTo(postLoginPath(me.value, undefined))
const actions = computed(() => visibleCommands(me.value))
const hasServices = computed(() => personalEntries(me.value).length > 0)
// Five pills at most, the standing services link included; the rest of the actions stay in the palette and `/apps`.
const quickActions = computed(() => homeQuickActions(actions.value, HOME_QUICK_LIMIT - (hasServices.value ? 1 : 0)))
const { available: hasWork } = useMyWork()
const hasApps = computed(() => reachableApplications(visibleShellModules(me.value)).length > 0)

// The date is the browser's: it is read after mount so the server and the browser draw the same first frame.
const firstName = computed(() => me.value?.name?.trim().split(/\s+/)[0] ?? '')
const today = ref('')
onMounted(() => { today.value = new Date().toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) })
</script>

<template>
  <SharedPageContainer width="list" data-testid="foundation-home">
    <SharedPageHeader :title="t('nav.home')" />
    <p class="-mt-2 text-sm text-muted" data-testid="home-greeting">
      <span v-if="firstName" class="font-medium text-highlighted">{{ t('home.greeting', { name: firstName }) }}</span>
      <span v-if="today"> · {{ today }}</span>
    </p>
    <HomeIndicators />
    <HomeFocus />
    <section v-if="actions.length || hasServices" :aria-label="t('home.quick')" class="space-y-3" data-testid="home-quick-actions">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-sm font-semibold text-muted">{{ t('home.quick') }}</h2>
        <UButton v-if="hasApps" to="/apps" color="neutral" variant="link" size="sm" :label="t('home.allApps')" data-testid="home-all-apps" />
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="hasServices" to="/account" color="neutral" variant="soft" size="sm" class="rounded-full" icon="i-lucide-concierge-bell" :label="t('nav.account')" data-testid="home-services" />
        <UButton v-for="action in quickActions" :key="action.id" :to="{ path: action.to, query: { returnTo: '/' } }" color="neutral" variant="soft" size="sm" class="rounded-full">
          <span class="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true"><UIcon name="i-lucide-plus" class="size-3.5" /></span>
          {{ t(action.labelKey) }}
        </UButton>
      </div>
    </section>
    <HomeAssistantSuggestions />
    <!-- The personal services link is a standing shortcut, not something for today, so it never hides this state. -->
    <template v-if="!hasWork && !actions.length">
      <SharedEmptyState v-if="hasApps" bordered :title="t('home.nothingToday')" data-testid="home-empty-today">
        <template #action><UButton to="/apps" color="neutral" variant="outline" class="rounded-full" :label="t('home.openApps')" /></template>
      </SharedEmptyState>
      <SharedEmptyState v-else bordered :title="t('home.empty')" data-testid="home-empty-no-apps">
        <template #action><UButton to="/account" color="neutral" variant="outline" class="rounded-full" :label="t('nav.account')" /></template>
      </SharedEmptyState>
    </template>
  </SharedPageContainer>
</template>
