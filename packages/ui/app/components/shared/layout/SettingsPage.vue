<script setup lang="ts">
withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), { width: 'list' })
</script>

<template>
  <div class="webvue-settings-layout" data-testid="settings-layout">
    <SharedPageContainer :width="width" class="webvue-settings-content">
      <slot />
    </SharedPageContainer>
  </div>
</template>
