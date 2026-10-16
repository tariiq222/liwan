<script setup lang="ts">
import BundleList from '@/pages/bundles/index.vue'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n()
useSectionCrumb(() => ({ label: t('vendor.bundles.title'), to: '/bundles' }))
const route = useRoute()
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/bundles/new')
</script>
<template><BundleList v-if="isCreateRoute" /><NuxtPage /></template>
