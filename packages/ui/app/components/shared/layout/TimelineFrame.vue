<script setup lang="ts">
// The timeline template (Tasmim Plan 4) for calendars and schedules: the page header and its actions, then one card
// (DESIGN.md §6, like SharedListCard): a hairline header row with the toolbar (previous / range / today / next as pill
// controls, and a SharedSegmentedControl scale group when `scales` is given) over the timeline in the default slot,
// which draws no ring of its own. The parent owns the range and the scale (keep the scale in the URL query) and this
// only emits. The chevrons point along the reading direction, so they mirror in RTL.
import SegmentedControl from '../data/SegmentedControl.vue'

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
    <div data-slot="timeline-card" class="min-w-0 overflow-hidden rounded-card bg-default ring ring-default">
      <div data-template="timeline-toolbar" class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-(--webvue-card-pad-dense) py-3">
        <div class="flex items-center gap-1.5" role="group" :aria-label="t('states.period')">
          <UButton type="button" color="neutral" variant="ghost" size="sm" square class="rounded-full" data-testid="timeline-prev" :disabled="!hydrated" :aria-label="t('states.previous')" @click="emit('prev')">
            <UIcon name="i-lucide-chevron-left" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
          </UButton>
          <span data-testid="timeline-range" aria-live="polite" class="min-w-40 text-center text-sm font-medium text-highlighted">{{ props.rangeLabel }}</span>
          <UButton type="button" color="neutral" variant="soft" size="sm" class="rounded-full" data-testid="timeline-today" :disabled="!hydrated" :label="t('states.today')" @click="emit('today')" />
          <UButton type="button" color="neutral" variant="ghost" size="sm" square class="rounded-full" data-testid="timeline-next" :disabled="!hydrated" :aria-label="t('states.next')" @click="emit('next')">
            <UIcon name="i-lucide-chevron-right" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
          </UButton>
        </div>
        <SegmentedControl
          v-if="props.scales?.length"
          data-testid="timeline-scale"
          :label="t('states.scale')"
          :items="props.scales"
          :model-value="props.scale ?? ''"
          @update:model-value="pick"
        />
      </div>
      <div data-template="timeline-body" class="min-w-0">
        <slot />
      </div>
    </div>
  </SharedPageContainer>
</template>
