<script setup lang="ts">
import AddonList from '@/pages/addons/index.vue'
definePageMeta({ capability: 'vendor.read' })
const route = useRoute()
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/addons/new')
</script>
<template><AddonList v-if="isCreateRoute" /><NuxtPage /></template>
