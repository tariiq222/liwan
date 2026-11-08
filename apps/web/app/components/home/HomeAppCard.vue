<script setup lang="ts">
import { appCardSurface } from '@/components/home/appCardSurface'
import { useAppFigures, type AppCardModel } from '@/composables/useAppCards'
import { useAttention } from '@/composables/useAttention'

// One application on home: a gradient card with its tile, name and tagline, up to two live numbers, a button that opens
// it, and a small preview of what in it needs the person. A number or preview that has not arrived draws nothing.
const PREVIEW_ROWS = 3
const props = defineProps<{ card: AppCardModel; description?: string }>()
const { t } = useI18n()
const id = useId()
const surface = computed(() => appCardSurface(props.card.surface))
const figures = useAppFigures(() => props.card.figures)
const { rows } = useAttention(() => props.card.id, { limit: PREVIEW_ROWS })
</script>

<template>
  <article
    :data-app="props.card.id"
    :aria-labelledby="`${id}-title`"
    :style="surface.style"
    :class="[
      'group relative flex h-[430px] w-[300px] flex-col overflow-hidden rounded-surface px-5.5 pt-5.5 transition duration-300 hover:-translate-y-1 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      'bg-[linear-gradient(170deg,var(--card-from),var(--card-to))] dark:bg-[linear-gradient(170deg,var(--card-from-dark),var(--card-to-dark))] dark:ring-1 dark:ring-white/10',
      surface.lightText ? 'text-white' : 'text-(--liwan-ink) dark:text-white',
    ]"
    data-testid="home-app-card"
  >
    <div class="mb-3.5 flex items-center gap-3">
      <span class="liwan-app-tile size-[3.14rem] shrink-0 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transition-none" aria-hidden="true"><UIcon :name="props.card.icon" class="size-5.5" /></span>
      <div class="min-w-0">
        <h3 :id="`${id}-title`" class="text-lg font-bold leading-tight">{{ t(props.card.labelKey) }}</h3>
        <p v-if="props.description" class="line-clamp-2 text-xs opacity-75">{{ props.description }}</p>
      </div>
    </div>
    <ul v-if="props.card.figures.length" class="mb-3.5 flex min-h-14 gap-4.5" data-testid="home-app-figures">
      <li v-for="figure in figures" :key="figure.labelKey">
        <b class="block font-display text-4xl font-bold leading-none tabular-nums" dir="ltr">{{ figure.value }}</b>
        <small class="text-xs opacity-75">{{ t(figure.labelKey) }}</small>
      </li>
    </ul>
    <NuxtLink
      :to="props.card.to"
      :aria-describedby="`${id}-title`"
      :class="['self-start rounded-control px-3.5 py-1.5 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current', surface.lightText ? 'bg-white/15 text-white' : 'bg-white text-(--liwan-ink) dark:bg-white/12 dark:text-white']"
      data-testid="home-app-open"
    >{{ t('launcher.open') }}</NuxtLink>
    <ul v-if="rows.length" :aria-label="t('appStart.attention')" class="mt-auto flex min-h-[10.7rem] flex-col gap-1.5 rounded-t-control bg-default p-3 text-xs text-default shadow-[0_-6px_18px_-10px_rgb(20_16_42/18%)]" data-testid="home-app-preview">
      <li v-for="row in rows" :key="row.id">
        <NuxtLink :to="row.to" class="flex items-center gap-2 rounded-inner bg-muted px-2.5 py-2 transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary" data-testid="home-app-preview-row">
          <span aria-hidden="true" :class="['size-2 shrink-0 rounded-full', row.tone === 'urgent' ? 'bg-warning' : 'bg-primary']" />
          <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          <span v-if="row.caption" class="max-w-[40%] shrink-0 truncate opacity-70">{{ row.caption }}</span>
        </NuxtLink>
      </li>
    </ul>
  </article>
</template>
