<script setup lang="ts">
/*
 * A titled block of a record's main column; `id` makes it a link target (`#milestones`). One card recipe for every
 * block that is a card (DESIGN.md §6): radius `rounded-card`, the hairline ring of the list card, a header row of
 * `--liwan-card-pad` inline padding, and the body padded by `--liwan-card-pad`.
 * `variant` picks the look:
 *   flat    no card: a page-section title (text-base) over the content (default)
 *   panel   the card: a panel title (text-sm) in a header row with a hairline below, a padded body
 *   list    a card whose body has no padding and divides its rows, for a list or a table inside the card
 *   tinted  secondary information: a soft elevated fill, no ring
 *   action  the one call to action of a page (a decision, a pending approval): primary tint, primary hairline and an inline-start accent
 * `title` is optional on the card variants (a card with no heading draws no header row).
 */
type Variant = 'flat' | 'panel' | 'list' | 'tinted' | 'action'
const CARD: Record<Exclude<Variant, 'flat'>, string> = {
  panel: 'bg-default ring ring-default',
  list: 'overflow-hidden bg-default ring ring-default',
  tinted: 'bg-elevated/40',
  action: 'border-s-4 border-s-primary bg-primary/5 ring ring-primary/30',
}
const props = withDefaults(defineProps<{ title?: string; description?: string; id?: string; variant?: Variant }>(), { variant: 'flat' })
const generated = useId()
const headingId = computed(() => `${props.id ?? generated}-title`)
const card = computed(() => props.variant !== 'flat')
const bordered = computed(() => props.variant === 'panel' || props.variant === 'list')
</script>

<template>
  <section
    :id="props.id"
    data-slot="record-section"
    :data-variant="props.variant"
    :class="card ? ['liwan-record-panel min-w-0 rounded-card', CARD[props.variant as keyof typeof CARD]] : 'space-y-3'"
    :aria-labelledby="props.title ? headingId : undefined"
  >
    <header
      v-if="props.title || props.description || $slots.actions"
      :class="card ? ['flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3', bordered && 'border-b border-default'] : 'flex flex-wrap items-start justify-between gap-3'"
    >
      <div class="min-w-0">
        <h2 v-if="props.title" :id="headingId" :class="card ? 'text-sm font-semibold text-highlighted' : 'text-base font-semibold text-highlighted'">{{ props.title }}</h2>
        <p v-if="props.description" class="text-sm text-muted" :class="{ 'mt-1': props.title }">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <div v-if="props.variant === 'list'" class="divide-y divide-default"><slot /></div>
    <div v-else-if="card" class="p-(--liwan-card-pad)" :class="{ 'pt-0': !bordered && (props.title || props.description || $slots.actions) }"><slot /></div>
    <slot v-else />
  </section>
</template>
