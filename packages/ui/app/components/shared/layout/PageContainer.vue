<script setup lang="ts">
const props = withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form' | 'full'
}>(), {
  width: 'list',
})

const widthClass = computed(() => `liwan-page-width-${props.width}`)
const route = useRoute()
const classify = usePageArea()
const pageArea = computed(() => classify(route.path))
const workspaceArea = computed(() => !pageArea.value.plain)
</script>

<template>
  <div
    data-slot="page-container"
    :data-layout-width="props.width"
    :data-workspace-area="workspaceArea || undefined"
    :data-page-record="pageArea.record || undefined"
    :class="['liwan-page-stack', widthClass]"
  >
    <slot />
  </div>
</template>
