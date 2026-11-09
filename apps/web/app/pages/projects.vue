<script setup lang="ts">
import ProjectList from '@/pages/projects/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/projects/new')
</script>

<template>
  <!-- One root element: the page transition cannot animate a fragment. `contents` keeps the wrapper out of the layout. -->
  <div class="contents">
    <ProjectList v-if="isCreateRoute" />
    <NuxtPage />
  </div>
</template>
