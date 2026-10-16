<script setup lang="ts">
// A titled block of a record's main column; `id` makes it a link target (`#milestones`).
// `panel` draws it as a card with its own header row (title + actions) and a padded body.
const props = defineProps<{ title: string; description?: string; id?: string; panel?: boolean }>()
const generated = useId()
const headingId = computed(() => `${props.id ?? generated}-title`)
</script>

<template>
  <section
    :id="props.id"
    data-slot="record-section"
    :class="props.panel ? 'webvue-record-panel min-w-0 rounded-lg bg-default ring ring-default' : 'space-y-3'"
    :aria-labelledby="headingId"
  >
    <header :class="props.panel ? 'flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3' : 'flex flex-wrap items-start justify-between gap-3'">
      <div class="min-w-0">
        <h2 :id="headingId" :class="props.panel ? 'text-sm font-semibold text-highlighted' : 'text-base font-semibold text-highlighted'">{{ props.title }}</h2>
        <p v-if="props.description" class="mt-1 text-sm text-muted">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <div v-if="props.panel" class="p-4"><slot /></div>
    <slot v-else />
  </section>
</template>
