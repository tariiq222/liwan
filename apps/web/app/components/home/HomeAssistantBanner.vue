<script setup lang="ts">
import { useAttention } from '@/composables/useAttention'
import { assistantSurface } from '@/modules/surfaces'
import { canReach } from '@/utils/accessPolicy'

// The Liwan AI banner on home: one slim row with up to three things the platform derived from the person's own tasks,
// meetings and requests (rules, no model call), each linking to its record, and a button to the assistant. Shown only to
// someone who may use the assistant; with nothing to say it still invites a question.
const SUGGESTIONS = 3
const { t } = useI18n()
const { me } = useMe()
const surface = computed(() => {
  const declared = assistantSurface()
  return declared && canReach(me.value, declared.capability, declared.to) ? declared : undefined
})
const { rows } = useAttention(() => (surface.value ? 'all' : null), { limit: SUGGESTIONS })
const title = computed(() => (rows.value.length ? t('home.banner.title', { n: rows.value.length }, rows.value.length) : t('home.banner.idle')))
</script>

<template>
  <section
    v-if="surface"
    :aria-label="t('ai.home.title')"
    class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-surface bg-[linear-gradient(110deg,color-mix(in_srgb,var(--liwan-ink)_8%,var(--ui-bg)),color-mix(in_srgb,var(--liwan-ink)_4%,var(--ui-bg))_40%,var(--ui-bg))] px-5 py-4 text-highlighted dark:bg-[linear-gradient(110deg,color-mix(in_srgb,var(--liwan-ink)_7%,var(--ui-bg)),color-mix(in_srgb,var(--liwan-ink)_5%,var(--ui-bg))_55%,color-mix(in_srgb,var(--liwan-ink)_8%,var(--ui-bg)))] dark:ring-1 dark:ring-default"
    data-testid="home-assistant-banner"
  >
    <span class="liwan-app-tile liwan-app-tile-md shrink-0" aria-hidden="true"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
    <div class="min-w-0 flex-1 basis-64">
      <h2 class="font-display text-lg font-bold leading-snug">{{ title }}</h2>
      <ul v-if="rows.length" class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="home-assistant-rows">
        <li v-for="row in rows" :key="row.id" class="flex min-w-0 items-center gap-1.5" data-testid="home-assistant-row">
          <span class="size-1 shrink-0 rounded-full bg-current opacity-50" aria-hidden="true" />
          <NuxtLink :to="row.to" class="min-w-0 truncate hover:underline focus-visible:outline-2 focus-visible:outline-primary" data-testid="home-assistant-link">{{ row.label }}</NuxtLink>
        </li>
      </ul>
    </div>
    <UButton :to="surface.to" class="shrink-0" icon="i-lucide-arrow-left" trailing :ui="{ trailingIcon: 'ltr:rotate-180' }" :label="t('ai.home.ask')" data-testid="home-assistant-ask" />
  </section>
</template>
