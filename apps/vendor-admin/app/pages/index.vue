<script setup lang="ts">
const { t } = useI18n()
useHead(() => ({ title: t('app.productName') }))
</script>

<template>
  <main class="p-4">
    <h1 class="text-xl font-semibold">
      {{ t('app.productName') }}
    </h1>
  </main>
</template>
