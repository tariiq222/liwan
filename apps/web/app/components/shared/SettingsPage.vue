<script setup lang="ts">
withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), { width: 'list' })
</script>

<template>
  <div class="nasq-settings-layout" data-testid="settings-layout">
    <SharedPageContainer :width="width" class="nasq-settings-content">
      <slot />
    </SharedPageContainer>
  </div>
</template>
