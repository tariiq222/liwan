<script setup lang="ts">
import LeaveList from '@/components/hr/LeaveList.vue'
const route = useRoute()
const isListRoute = computed(() => route.path.replace(/\/+$/, '') === '/hr/leave')
</script>

<template>
  <LeaveList v-if="isListRoute" />
  <NuxtPage />
</template>
