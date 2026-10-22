<script setup lang="ts">
definePageMeta({ path: '/account/leave' })
import HrLeaveList from '@/components/hr/LeaveList.vue'
const route = useRoute()
const isListRoute = computed(() => route.path.replace(/\/+$/, '') === '/account/leave')
</script>

<template>
  <HrLeaveList v-if="isListRoute" personal />
  <NuxtPage />
</template>
