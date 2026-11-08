<script setup lang="ts">
import { useAttention } from '@/composables/useAttention'
import { assistantSurface } from '@/modules/surfaces'
import { canReach } from '@/utils/accessPolicy'

// The Liwan AI banner on home: up to three things the platform derived from the person's own tasks, meetings and requests
// (rules, no model call), each linking to its record, and a button to the assistant. Shown only to someone who may use the
// assistant; with nothing to say it still invites a question. The tiles on the right are decoration.
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
    class="relative grid items-center gap-6 overflow-hidden rounded-surface bg-[linear-gradient(110deg,color-mix(in_srgb,var(--liwan-ink)_8%,var(--ui-bg)),color-mix(in_srgb,var(--liwan-ink)_4%,var(--ui-bg))_40%,var(--ui-bg))] p-8 pt-7 text-highlighted dark:bg-[linear-gradient(110deg,color-mix(in_srgb,var(--liwan-ink)_7%,var(--ui-bg)),color-mix(in_srgb,var(--liwan-ink)_5%,var(--ui-bg))_55%,color-mix(in_srgb,var(--liwan-ink)_8%,var(--ui-bg)))] dark:ring-1 dark:ring-default xl:grid-cols-[1.4fr_1fr] max-md:p-5"
    data-testid="home-assistant-banner"
  >
    <div>
      <span class="inline-flex items-center gap-2 rounded-full bg-default/70 py-1 pe-3 ps-1.5 text-sm font-medium dark:bg-white/10">
        <span class="liwan-app-tile size-[1.57rem] rounded-inner!" aria-hidden="true"><UIcon name="i-lucide-sparkles" class="size-3" /></span>
        {{ t('ai.home.title') }}
      </span>
      <h2 class="mb-2 mt-3.5 font-display text-3xl font-bold leading-tight max-md:text-2xl">{{ title }}</h2>
      <ul v-if="rows.length" class="mb-5 grid gap-1.5 text-base" data-testid="home-assistant-rows">
        <li v-for="row in rows" :key="row.id" class="flex items-center gap-2" data-testid="home-assistant-row">
          <UIcon name="i-lucide-check" class="size-4 shrink-0 text-primary" aria-hidden="true" />
          <NuxtLink :to="row.to" class="min-w-0 break-words hover:underline focus-visible:outline-2 focus-visible:outline-primary" data-testid="home-assistant-link">{{ row.label }}</NuxtLink>
        </li>
      </ul>
      <UButton :to="surface.to" :class="rows.length ? '' : 'mt-3.5'" icon="i-lucide-arrow-left" trailing :ui="{ trailingIcon: 'ltr:rotate-180' }" :label="t('ai.home.ask')" data-testid="home-assistant-ask" />
    </div>
    <div class="relative h-[14.3rem] max-xl:hidden" aria-hidden="true">
      <span data-app="crm" class="liwan-app-tile absolute end-[24%] top-2.5 size-[5.57rem] rounded-surface! shadow-xl"><UIcon name="i-lucide-handshake" class="size-8" /></span>
      <span data-app="inbox" class="liwan-app-tile absolute end-[2%] top-16 size-[5.57rem] -rotate-8 rounded-surface! shadow-xl"><UIcon name="i-lucide-messages-square" class="size-8" /></span>
      <span class="liwan-app-tile absolute end-[40%] top-24 size-[5.57rem] rotate-6 rounded-surface! shadow-xl"><UIcon name="i-lucide-sparkles" class="size-8" /></span>
      <span class="liwan-app-tile absolute end-[58%] top-0 size-[5.57rem] rotate-10 rounded-surface! shadow-xl"><UIcon name="i-lucide-check-square" class="size-8" /></span>
    </div>
  </section>
</template>
