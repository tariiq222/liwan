<script setup lang="ts">
import PackageList from '@/pages/vendor/catalog/index.vue'
const route = useRoute()
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/vendor/catalog/new')
</script>
<template><PackageList v-if="isCreateRoute" /><NuxtPage /></template>
