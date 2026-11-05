<script setup lang="ts">
const route = useRoute()
const classify = usePageArea()
const pageArea = computed(() => classify(route.path))
const workspaceArea = computed(() => !pageArea.value.plain)
</script>

<template>
  <div
    data-slot="page-container"
    :data-workspace-area="workspaceArea || undefined"
    :data-page-record="pageArea.record || undefined"
    class="liwan-page-stack"
  >
    <slot />
  </div>
</template>
