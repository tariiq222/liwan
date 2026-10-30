<script setup lang="ts">
import type { StartCard } from '@/composables/nav/appStartModel'
import type { AttentionRowWithModule } from '@/composables/nav/attentionModel'

// The body of an application's start page: what needs attention (hidden when nothing does), then the pages and
// create actions the user may start from. Everything comes from the application's manifest.
const props = defineProps<{ attention: AttentionRowWithModule[]; cards: StartCard[]; creates: StartCard[] }>()
const { t } = useI18n()
</script>

<template>
  <div class="space-y-6" data-testid="app-start-content">
    <section v-if="props.attention.length" :aria-label="t('appStart.attention')" class="space-y-3" data-testid="app-start-attention">
      <h2 class="text-sm font-semibold text-muted">{{ t('appStart.attention') }}</h2>
      <ul class="flex flex-col gap-2">
        <li v-for="row in props.attention" :key="row.id" class="rounded-card bg-default p-3 ring ring-default" data-testid="app-start-attention-row">
          <p class="flex items-center gap-2">
            <span aria-hidden="true" :class="['size-2 shrink-0 rounded-full', row.tone === 'urgent' ? 'bg-warning' : 'bg-primary']" />
            <NuxtLink :to="row.to" class="min-w-0 break-words text-sm font-medium text-highlighted hover:underline focus-visible:ring-2 focus-visible:ring-primary">{{ row.label }}</NuxtLink>
          </p>
          <p v-if="row.caption" class="ms-4 text-xs text-muted">{{ row.caption }}</p>
        </li>
      </ul>
    </section>
    <section v-if="props.cards.length || props.creates.length" :aria-label="t('appStart.start')" class="space-y-3" data-testid="app-start-links">
      <h2 class="text-sm font-semibold text-muted">{{ t('appStart.start') }}</h2>
      <div class="grid gap-(--liwan-gap-card) sm:grid-cols-2 xl:grid-cols-3">
        <SharedLinkCard v-for="card in props.cards" :key="card.id" :to="card.to" :icon="card.icon" :title="t(card.labelKey)" data-testid="app-start-card" />
        <SharedLinkCard v-for="card in props.creates" :key="card.id" :to="card.to" :icon="card.icon" :title="t(card.labelKey)" tone="neutral" data-testid="app-start-create" />
      </div>
    </section>
  </div>
</template>
