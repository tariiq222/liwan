<script setup lang="ts">
import HrLeaveList from '@/components/hr/LeaveList.vue'
const route = useRoute()
const isListRoute = computed(() => route.path.replace(/\/+$/, '') === '/hr/leave')
</script>

<template>
  <HrLeaveList v-if="isListRoute" />
  <NuxtPage />
</template>
