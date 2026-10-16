<script setup lang="ts">
// Page navigation for every paged list. Hidden when everything fits on one page.
// The page buttons wrap on narrow screens: in Arabic at 390px one row is wider than the content.
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
      :ui="{ root: 'min-w-0 max-w-full', list: 'flex-wrap' }"
      color="neutral"
      variant="ghost"
      active-color="primary"
      active-variant="subtle"
      :disabled="props.disabled || !hydrated"
      @update:page="value => emit('update:page', value)"
    />
  </nav>
</template>
