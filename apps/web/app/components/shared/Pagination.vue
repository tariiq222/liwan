<script setup lang="ts">
// Page navigation for every paged list. Hidden when everything fits on one page.
const props = defineProps<{
  page: number
  pages: number
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <nav v-if="props.pages > 1" class="flex flex-wrap items-center justify-between gap-3" :aria-label="t('app.pagination')" data-testid="shared-pagination">
    <span class="text-sm text-muted tabular-nums">{{ t('app.pageOf', { page: props.page, pages: props.pages }) }}</span>
    <UPagination
      :page="props.page"
      :total="props.pages"
      :items-per-page="1"
      :sibling-count="1"
      show-edges
      color="neutral"
      variant="ghost"
      active-color="primary"
      active-variant="subtle"
      :disabled="props.disabled || !hydrated"
      @update:page="value => emit('update:page', value)"
    />
  </nav>
</template>
