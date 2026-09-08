<script setup lang="ts">
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-nasq-shell class="nasq-shell" :data-direction="dir">
    <ShellHeader />
    <AppSidebar />
    <div class="nasq-shell-workspace">
      <main data-testid="shell-main" class="nasq-shell-main">
        <slot />
      </main>
    </div>
    <Toaster :dir="dir" />
  </div>
</template>
