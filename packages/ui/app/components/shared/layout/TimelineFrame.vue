<script setup lang="ts">
// The timeline template (Tasmim Plan 4) for calendars and schedules: the page header
// and its actions, one toolbar (previous / range / today / next, and a scale switch
// when `scales` is given), then the timeline in the default slot. The parent owns the
// range and the scale (keep the scale in the URL query) and this only emits. The
// chevrons point along the reading direction, so they mirror in RTL.
const props = defineProps<{
  title: string
  rangeLabel: string
  scale?: string
  scales?: { value: string; label: string }[]
  /** A frame around the page already shows the heading: draw no second one. Actions still render. */
  hideHeader?: boolean
}>()
const emit = defineEmits<{ prev: []; next: []; today: []; 'update:scale': [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()

function pick(value: string) {
  if (value !== props.scale) emit('update:scale', value)
}
</script>

<template>
  <SharedPageContainer width="list" data-template="timeline-frame">
    <SharedPageHeader :title="props.title" :hide-title="props.hideHeader">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <div data-template="timeline-toolbar" class="flex flex-wrap items-center justify-between gap-3 rounded-card bg-default p-3 ring ring-default">
      <div class="flex items-center gap-2" role="group" :aria-label="t('states.period')">
        <UButton type="button" color="neutral" variant="ghost" square data-testid="timeline-prev" :disabled="!hydrated" :aria-label="t('states.previous')" @click="emit('prev')">
          <UIcon name="i-lucide-chevron-left" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
        </UButton>
        <span data-testid="timeline-range" aria-live="polite" class="min-w-40 text-center text-sm font-medium text-highlighted">{{ props.rangeLabel }}</span>
        <UButton type="button" color="neutral" variant="outline" size="sm" data-testid="timeline-today" :disabled="!hydrated" :label="t('states.today')" @click="emit('today')" />
        <UButton type="button" color="neutral" variant="ghost" square data-testid="timeline-next" :disabled="!hydrated" :aria-label="t('states.next')" @click="emit('next')">
          <UIcon name="i-lucide-chevron-right" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
        </UButton>
      </div>
      <div v-if="props.scales?.length" role="group" :aria-label="t('states.scale')" data-testid="timeline-scale" class="inline-flex items-center gap-0.5 rounded-full bg-default p-0.5 ring ring-default">
        <UButton
          v-for="option in props.scales"
          :key="option.value"
          type="button"
          color="neutral"
          size="sm"
          :aria-pressed="option.value === props.scale"
          :variant="option.value === props.scale ? 'soft' : 'ghost'"
          :disabled="!hydrated"
          :label="option.label"
          @click="pick(option.value)"
        />
      </div>
    </div>
    <div data-template="timeline-body" class="min-w-0">
      <slot />
    </div>
  </SharedPageContainer>
</template>
