<script setup lang="ts">
import RoleList from '@/pages/settings/roles/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/settings/roles/new')
</script>

<template>
  <RoleList v-if="isCreateRoute" />
  <NuxtPage />
</template>
