<script setup lang="ts">
import PlanList from '@/pages/plans/index.vue'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n()
useSectionCrumb(() => ({ label: t('vendor.plans.title'), to: '/plans' }))
const route = useRoute()
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/plans/new')
</script>
<template><PlanList v-if="isCreateRoute" /><NuxtPage /></template>
