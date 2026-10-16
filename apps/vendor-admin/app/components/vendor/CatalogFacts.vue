<script setup lang="ts">
// The strip under a catalog record's heading: its lifecycle state first, then the few facts that say what is sold and to whom.
defineProps<{ facts: { key: string, label: string, value: string | number }[] }>()
</script>
<template>
  <dl data-slot="catalog-facts" class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg p-4 ring ring-default sm:grid-cols-[auto_repeat(auto-fit,minmax(8rem,1fr))]">
    <div><dt class="text-sm text-muted">{{ $t('vendor.common.status') }}</dt><dd class="mt-1"><slot name="status" /></dd></div>
    <div v-for="fact in facts" :key="fact.key" :data-fact="fact.key"><dt class="text-sm text-muted">{{ fact.label }}</dt><dd class="mt-1 font-semibold tabular-nums">{{ fact.value }}</dd></div>
  </dl>
</template>
