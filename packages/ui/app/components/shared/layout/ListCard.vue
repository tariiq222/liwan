<script setup lang="ts">
/*
 * The card of a list page (DESIGN.md §6): one 18px card with an optional header row for the embedded filter bar
 * (the `filters` slot, a hairline below it) and the list's surface under it: a bare SharedDataTable, a board or
 * any other view. Switching views swaps only the default slot; the card and its filter row stay mounted.
 * `fill` is for a surface that must be exactly screen-sized (a board, a timeline, a calendar): from 768px up the card
 * docks under the floating header while the page scrolls and is as tall as the viewport area below it (the shell's
 * `--shell-top` and `--shell-inset`, at least 420px); the filter row keeps its height and the surface takes the rest
 * and scrolls inside itself, so the page gains no second vertical scroll. Below 768px it is an ordinary card.
 * The optional `footer` slot is the card's last row (a hairline above it, the card's padding): the result count and
 * pager of SharedListFooter, so a page never wraps its pager in its own bordered div.
 */
defineProps<{ fill?: boolean }>()
</script>

<template>
  <div data-slot="list-card" :data-fill="fill || undefined" class="min-w-0 overflow-hidden rounded-card bg-default ring ring-default" :class="{ 'webvue-list-card-fill': fill }">
    <div v-if="$slots.filters" data-slot="list-card-filters" class="min-w-0 flex-none border-b border-default px-(--webvue-card-pad-dense) py-3"><slot name="filters" /></div>
    <div v-if="fill" data-slot="list-card-body" class="flex min-h-0 flex-1 flex-col"><slot /></div>
    <slot v-else />
    <div v-if="$slots.footer" data-slot="list-card-footer" class="flex min-w-0 flex-none flex-wrap items-center justify-between gap-3 border-t border-default px-(--webvue-card-pad-dense) py-3 text-sm text-muted"><slot name="footer" /></div>
  </div>
</template>
