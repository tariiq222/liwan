<script setup lang="ts">
withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), { width: 'list' })
</script>

<template>
  <div class="liwan-settings-layout" data-testid="settings-layout">
    <SharedPageContainer :width="width" class="liwan-settings-content">
      <slot />
    </SharedPageContainer>
  </div>
</template>
