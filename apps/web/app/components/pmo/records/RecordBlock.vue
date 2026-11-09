<script setup lang="ts">
// A titled block of a record's main column. No card: a small heading with its count, the content below.
// `id` makes it a link target (`#schedule`); the `actions` slot sits at the inline end of the heading.
const props = defineProps<{ title: string; count?: number | string; id?: string }>()
const generated = useId()
const headingId = computed(() => `${props.id ?? generated}-title`)
</script>

<template>
  <section :id="props.id" class="grid min-w-0 gap-2" :aria-labelledby="headingId">
    <header class="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h2 :id="headingId" class="text-sm font-semibold text-highlighted">
        {{ props.title }}<span v-if="props.count !== undefined" class="ms-2 text-xs font-normal text-muted tabular-nums"><bdi>{{ props.count }}</bdi></span>
      </h2>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
