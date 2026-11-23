<script setup lang="ts">
// The catalog section's plain-language glossary, shown at the top of the catalog, bundles and plans
// pages: one sentence per term, open by default and collapsible.
const { t } = useI18n()
const defs = computed(() => [
  { term: t('vendor.catalog.glossary.app'), text: t('vendor.catalog.glossary.appText') },
  { term: t('vendor.catalog.glossary.release'), text: t('vendor.catalog.glossary.releaseText') },
  { term: t('vendor.catalog.glossary.bundle'), text: t('vendor.catalog.glossary.bundleText') },
  { term: t('vendor.catalog.glossary.plan'), text: t('vendor.catalog.glossary.planText') },
])
</script>
<template>
  <details open class="group rounded-control bg-elevated px-4 py-3 text-sm ring ring-default" data-testid="catalog-glossary">
    <summary class="flex cursor-pointer list-none select-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
      <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      {{ t('vendor.catalog.glossary.summary') }}
    </summary>
    <ul class="mt-3 space-y-2 text-muted">
      <li v-for="def in defs" :key="def.term"><span class="font-semibold text-default">{{ def.term }}</span> {{ def.text }}</li>
    </ul>
  </details>
</template>
