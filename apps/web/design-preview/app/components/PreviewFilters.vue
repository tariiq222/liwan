<script setup lang="ts">
const { t, route } = usePreview()
const open = ref(false)
const query = computed({ get: () => String(route.query.q || ''), set: q => { void navigateTo({ query: { ...route.query, q: q || undefined } }, { replace: true }) } })
const status = computed({ get: () => String(route.query.status || 'all'), set: value => { void navigateTo({ query: { ...route.query, status: value === 'all' ? undefined : value } }, { replace: true }) } })
const count = computed(() => Number(Boolean(query.value)) + Number(status.value !== 'all'))
const summary = computed(() => [query.value, status.value !== 'all' ? t(status.value) : ''].filter(Boolean).join(' · '))
function clear() { return navigateTo({ query: { ...route.query, q: undefined, status: undefined } }, { replace: true }) }
</script>
<template>
  <UPopover v-model:open="open">
    <UButton type="button" color="neutral" variant="outline" icon="i-lucide-sliders-horizontal" :aria-label="t('filters')" :title="t('filters')" />
    <template #content>
      <div class="preview-filter-content">
        <UFormField :label="t('search')"><UInput v-model="query" :placeholder="t('searchHint')" icon="i-lucide-search" class="w-full" /></UFormField>
        <UFormField :label="t('status')"><USelect v-model="status" :items="['all', 'active', 'done', 'waiting'].map(value => ({ value, label: t(value) }))" class="w-full" /></UFormField>
        <UButton v-if="count" type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('clear')" :title="t('clear')" class="justify-self-end" @click="clear" />
      </div>
    </template>
  </UPopover>
  <span v-if="count" class="preview-filter-summary" aria-live="polite">
    <UBadge color="neutral" variant="subtle">{{ count }} {{ t('activeFilters') }}</UBadge>
    <span>{{ summary }}</span>
  </span>
</template>
