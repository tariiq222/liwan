<script setup lang="ts">
import PartnerList from '@/pages/finance/partners/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/finance/partners/new')
</script>

<template>
  <PartnerList v-if="isCreateRoute" />
  <NuxtPage />
</template>
