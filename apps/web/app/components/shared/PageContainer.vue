<script setup lang="ts">
const props = withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), {
  width: 'list',
})

const widthClass = computed(() => `nasq-page-width-${props.width}`)
const route = useRoute()
const projectArea = computed(() => /^\/(projects|project-templates)(\/|$)/.test(route.path) || /^\/settings\/projects(\/|$)/.test(route.path))
</script>

<template>
  <div
    data-slot="page-container"
    :data-layout-width="props.width"
    :data-project-area="projectArea || undefined"
    :class="['nasq-page-stack', widthClass]"
  >
    <slot />
  </div>
</template>
