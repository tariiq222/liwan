<script setup lang="ts">
import CatalogList from '@/pages/settings/apps/projects/catalogs/[resource]/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => /\/settings\/apps\/projects\/catalogs\/[^/]+\/new$/.test(route.path.replace(/\/+$/, '') || '/'))
</script>

<template>
  <CatalogList v-if="isCreateRoute" />
  <NuxtPage />
</template>
