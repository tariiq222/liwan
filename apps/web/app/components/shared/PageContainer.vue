<script setup lang="ts">
const props = withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), {
  width: 'list',
})

const widthClass = computed(() => ({
  list: 'max-w-[1440px]',
  detail: 'max-w-6xl',
  form: 'max-w-3xl',
}[props.width]))
</script>

<template>
  <div
    data-slot="page-container"
    :data-layout-width="props.width"
    :class="['mx-auto w-full space-y-6', widthClass]"
  >
    <slot />
  </div>
</template>
