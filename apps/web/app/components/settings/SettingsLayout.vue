<script setup lang="ts">
import SettingsTabs from './SettingsTabs.vue'
</script>

<template>
  <div class="nasq-settings-layout" data-testid="settings-layout">
    <SettingsTabs />
    <div class="min-w-0 w-full max-w-[760px]">
      <slot />
    </div>
  </div>
</template>
