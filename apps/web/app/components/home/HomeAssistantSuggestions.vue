<script setup lang="ts">
import { useAttention } from '@/composables/useAttention'
import { assistantSurface } from '@/modules/surfaces'
import { canReach } from '@/utils/accessPolicy'

// Suggestions for today on the home page: plain sentences the platform derives from the user's own tasks, meetings and
// requests (rules, no model call), each linking to its record. Shown only to someone who may use the assistant and only
// when there is something to say; never an empty card.
const { t } = useI18n()
const { me } = useMe()
const surface = computed(() => {
  const declared = assistantSurface()
  return declared && canReach(me.value, declared.capability, declared.to) ? declared : undefined
})
const { rows } = useAttention(() => (surface.value ? 'all' : null), { limit: 3 })
</script>

<template>
  <section v-if="surface && rows.length" :aria-label="t('ai.home.title')" class="rounded-card bg-default p-4 ring ring-default" data-testid="home-assistant-suggestions">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('ai.home.title') }}</h2>
        <p class="text-xs text-muted">{{ t('ai.home.source') }}</p>
      </div>
      <UButton :to="surface.to" color="neutral" variant="outline" size="sm" class="liwan-touch-target rounded-full" icon="i-lucide-sparkles" :label="t('ai.home.ask')" data-testid="home-assistant-ask" />
    </div>
    <ul class="mt-3 flex flex-col gap-2">
      <li v-for="row in rows" :key="row.id" class="rounded-control border border-default bg-muted p-3" data-testid="home-assistant-row">
        <p class="flex items-center gap-2 text-xs font-medium text-muted">
          <span aria-hidden="true" :class="['size-2 shrink-0 rounded-full', row.tone === 'urgent' ? 'bg-warning' : 'bg-primary']" />
          {{ t('ai.suggestionLabel') }}
        </p>
        <NuxtLink :to="row.to" class="mt-1 block break-words text-sm font-medium text-highlighted hover:underline focus-visible:ring-2 focus-visible:ring-primary" data-testid="home-assistant-link">{{ row.label }}</NuxtLink>
        <p v-if="row.caption" class="text-xs text-muted">{{ row.caption }}</p>
        <p v-if="row.suggestion" class="mt-1 break-words text-sm text-default">{{ row.suggestion }}</p>
      </li>
    </ul>
  </section>
</template>
