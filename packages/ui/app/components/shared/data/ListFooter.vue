<script setup lang="ts">
// The last row of a list card (DESIGN.md §6): the result count at the start and the pager at the end. It fills the
// `footer` slot of SharedListCard (or of a bare SharedDataTable). The caller translates the count, so the layer keeps
// no application key; the pager hides itself when everything fits on one page.
withDefaults(defineProps<{ countLabel: string; page: number; pages: number; disabled?: boolean; countTestId?: string }>(), { countTestId: undefined })
defineEmits<{ 'update:page': [page: number] }>()
</script>

<template>
  <div data-slot="list-footer" class="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
    <span class="tabular-nums" :data-testid="countTestId">{{ countLabel }}</span>
    <SharedPagination :page="page" :pages="pages" :disabled="disabled" @update:page="$emit('update:page', $event)" />
  </div>
</template>
