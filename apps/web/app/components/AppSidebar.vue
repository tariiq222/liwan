<script setup lang="ts">
import ModuleRail from './shell/ModuleRail.vue'
import ContextSidebar from './shell/ContextSidebar.vue'

defineProps<{ showContext: boolean }>()
</script>

<template>
  <ModuleRail />
  <ContextSidebar v-if="showContext" />
</template>
