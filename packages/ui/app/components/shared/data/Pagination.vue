<script setup lang="ts">
// Page navigation for every paged list. Hidden when everything fits on one page.
// The page buttons wrap on narrow screens: in Arabic at 390px one row is wider than the content.
const props = defineProps<{
  page: number
  pages: number
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const { t, localeProperties } = useI18n()
const hydrated = useHydrated()
// Reka's own labels are English ("Next Page", "Page 3"), so every control is relabeled through the slots.
// The chevrons follow the reading direction, as Nuxt UI's defaults do.
const rtl = computed(() => localeProperties.value.dir === 'rtl')
const icons = computed(() => (rtl.value
  ? { first: 'i-lucide-chevrons-right', prev: 'i-lucide-chevron-right', next: 'i-lucide-chevron-left', last: 'i-lucide-chevrons-left' }
  : { first: 'i-lucide-chevrons-left', prev: 'i-lucide-chevron-left', next: 'i-lucide-chevron-right', last: 'i-lucide-chevrons-right' }))
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
      :ui="{ root: 'min-w-0 max-w-full', list: 'flex-wrap gap-1' }"
      color="neutral"
      variant="outline"
      size="sm"
      active-color="primary"
      active-variant="solid"
      :disabled="props.disabled || !hydrated"
      @update:page="value => emit('update:page', value)"
    >
      <template #first><UButton color="neutral" variant="outline" size="sm" :icon="icons.first" :aria-label="t('app.pageFirst')" square /></template>
      <template #prev><UButton color="neutral" variant="outline" size="sm" :icon="icons.prev" :label="t('app.pagePrevious')" :aria-label="t('app.pagePrevious')" /></template>
      <template #item="{ item, page }">
        <UButton
          v-if="item.type === 'page'"
          size="sm"
          :color="page === item.value ? 'primary' : 'neutral'"
          :variant="page === item.value ? 'solid' : 'outline'"
          :label="String(item.value)"
          :aria-label="t('app.pageNumber', { page: item.value })"
          :aria-current="page === item.value ? 'page' : undefined"
          class="tabular-nums"
          square
        />
      </template>
      <template #next><UButton color="neutral" variant="outline" size="sm" :trailing-icon="icons.next" :label="t('app.pageNext')" :aria-label="t('app.pageNext')" /></template>
      <template #last><UButton color="neutral" variant="outline" size="sm" :icon="icons.last" :aria-label="t('app.pageLast')" square /></template>
    </UPagination>
  </nav>
</template>
