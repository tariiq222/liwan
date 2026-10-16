<script setup lang="ts">
import TeamList from '@/pages/team/index.vue'
definePageMeta({ capability: 'vendor.accounts.manage' })
const route = useRoute()
// The invite panel opens over the list, as the plan and bundle panels do.
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/team/new')
</script>
<template><TeamList v-if="isCreateRoute" /><NuxtPage /></template>
