<script setup lang="ts">
// The timeline controls (DESIGN.md §6): previous / range / today / next as pill controls, and a SharedSegmentedControl
// scale group when `scales` is given. The parent owns the range and the scale (keep the scale in the URL query) and this
// only emits. The chevrons point along the reading direction, so they mirror in RTL. SharedTimelineFrame draws it in its
// card header; a list card that hosts a timeline view draws it in its own toolbar row.
import SegmentedControl from '../data/SegmentedControl.vue'

const props = defineProps<{
  rangeLabel: string
  scale?: string
  scales?: { value: string; label: string }[]
}>()
const emit = defineEmits<{ prev: []; next: []; today: []; 'update:scale': [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()

function pick(value: string) {
  if (value !== props.scale) emit('update:scale', value)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3" data-slot="timeline-controls">
    <div class="flex items-center gap-1.5" role="group" :aria-label="t('states.period')">
      <UButton type="button" color="neutral" variant="ghost" size="sm" square data-testid="timeline-prev" :disabled="!hydrated" :aria-label="t('states.previous')" @click="emit('prev')">
        <UIcon name="i-lucide-chevron-left" class="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
      </UButton>
      <span data-testid="timeline-range" aria-live="polite" class="min-w-40 text-center text-sm font-medium text-highlighted">{{ props.rangeLabel }}</span>
      <UButton type="button" color="neutral" variant="soft" size="sm" data-testid="timeline-today" :disabled="!hydrated" :label="t('states.today')" @click="emit('today')" />
      <UButton type="button" color="neutral" variant="ghost" size="sm" square data-testid="timeline-next" :disabled="!hydrated" :aria-label="t('states.next')" @click="emit('next')">
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
</template>
