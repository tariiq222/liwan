<script setup lang="ts">
definePageMeta({ path: '/account/leave' })
import LeaveList from '@/components/hr/LeaveList.vue'
const route = useRoute()
const isListRoute = computed(() => route.path.replace(/\/+$/, '') === '/account/leave')
</script>

<template>
  <LeaveList v-if="isListRoute" personal />
  <NuxtPage />
</template>
