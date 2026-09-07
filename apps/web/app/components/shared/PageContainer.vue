<script setup lang="ts">
const props = withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), {
  width: 'list',
})

const widthClass = computed(() => `nasq-page-width-${props.width}`)
</script>

<template>
  <div
    data-slot="page-container"
    :data-layout-width="props.width"
    :class="['nasq-page-stack', widthClass]"
  >
    <slot />
  </div>
</template>
