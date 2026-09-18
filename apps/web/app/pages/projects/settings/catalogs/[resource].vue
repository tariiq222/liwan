<script setup lang="ts">
import CatalogList from '@/pages/projects/settings/catalogs/[resource]/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => /\/projects\/settings\/catalogs\/[^/]+\/new$/.test(route.path.replace(/\/+$/, '') || '/'))
</script>

<template>
  <CatalogList v-if="isCreateRoute" />
  <NuxtPage />
</template>
