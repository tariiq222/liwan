<script setup lang="ts">
import UserList from '@/pages/settings/team/users/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/settings/team/users/new')
</script>

<template>
  <UserList v-if="isCreateRoute" />
  <NuxtPage />
</template>
