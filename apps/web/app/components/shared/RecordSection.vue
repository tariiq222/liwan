<script setup lang="ts">
// A titled block of a record's main column; `id` makes it a link target (`#milestones`).
const props = defineProps<{ title: string; description?: string; id?: string }>()
const generated = useId()
const headingId = computed(() => `${props.id ?? generated}-title`)
</script>

<template>
  <section :id="props.id" data-slot="record-section" class="space-y-3" :aria-labelledby="headingId">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 :id="headingId" class="text-base font-semibold text-highlighted">{{ props.title }}</h2>
        <p v-if="props.description" class="mt-1 text-sm text-muted">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
