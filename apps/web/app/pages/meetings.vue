<script setup lang="ts">
import MeetingList from '@/pages/meetings/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/meetings/new')
</script>

<template>
  <MeetingList v-if="isCreateRoute" />
  <NuxtPage />
</template>
