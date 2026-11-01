<script setup lang="ts">
// «يومي» and «التطبيقات» read as one page: each tab keeps its own route, so direct links and back still work.
const { t } = useI18n()
const route = useRoute()
const tabs = computed(() => [
  { key: 'home-tab-today', label: t('nav.home'), to: '/', active: route.path === '/' },
  { key: 'home-tab-apps', label: t('nav.apps'), to: '/apps', active: route.path === '/apps' },
])
</script>

<template>
  <SharedRouteTabs variant="pill" :items="tabs" :ariaLabel="t('nav.home')" data-testid="home-tabs" />
</template>
