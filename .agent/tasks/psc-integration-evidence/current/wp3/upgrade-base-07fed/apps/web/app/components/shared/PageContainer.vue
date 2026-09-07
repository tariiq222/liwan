<script setup lang="ts">
const props = withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), {
  width: 'list',
})

const widthClass = computed(() => ({
  list: 'max-w-[1440px]',
  detail: 'max-w-[1440px]',
  form: 'max-w-[940px]',
}[props.width]))
</script>

<template>
  <div
    data-slot="page-container"
    :data-layout-width="props.width"
    :class="['nasq-page-stack mx-auto w-full', widthClass]"
  >
    <slot />
  </div>
</template>
