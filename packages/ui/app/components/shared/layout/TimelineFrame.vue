<script setup lang="ts">
// The timeline template (Tasmim Plan 4) for calendars and schedules: the page header and its actions, then one card
// (DESIGN.md §6, like SharedListCard): a hairline header row with the toolbar (SharedTimelineControls: previous / range /
// today / next as pill controls, and a scale group when `scales` is given) over the timeline in the default slot,
// which draws no ring of its own. The parent owns the range and the scale (keep the scale in the URL query) and this
// only emits.
import TimelineControls from './TimelineControls.vue'

const props = defineProps<{
  title: string
  rangeLabel: string
  scale?: string
  scales?: { value: string; label: string }[]
  /** A frame around the page already shows the heading: draw no second one. Actions still render. */
  hideHeader?: boolean
}>()
const emit = defineEmits<{ prev: []; next: []; today: []; 'update:scale': [string] }>()
</script>

<template>
  <SharedPageContainer data-template="timeline-frame">
    <SharedPageHeader :title="props.title" :hide-title="props.hideHeader">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <div data-slot="timeline-card" class="liwan-card min-w-0 overflow-hidden rounded-card">
      <div data-template="timeline-toolbar" class="border-b border-default px-(--liwan-card-pad-dense) py-3">
        <TimelineControls
          class="justify-between"
          :range-label="props.rangeLabel"
          :scale="props.scale"
          :scales="props.scales"
          @prev="emit('prev')"
          @today="emit('today')"
          @next="emit('next')"
          @update:scale="emit('update:scale', $event)"
        />
      </div>
      <div data-template="timeline-body" class="min-w-0">
        <slot />
      </div>
    </div>
  </SharedPageContainer>
</template>
