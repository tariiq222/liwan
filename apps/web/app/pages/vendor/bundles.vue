<script setup lang="ts">
import BundleList from '@/pages/vendor/bundles/index.vue'
const route = useRoute()
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/vendor/bundles/new')
</script>
<template><BundleList v-if="isCreateRoute" /><NuxtPage /></template>
