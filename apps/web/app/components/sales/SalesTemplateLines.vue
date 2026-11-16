<script setup lang="ts">
import type { SalesTemplateLine } from '@liwan/contracts'

// The lines of a quotation template, read-only and in order: a section as a heading, a note as a paragraph, a product
// with its quantity. A product line that can no longer start a quotation is marked, because it refuses the quotation.
const props = defineProps<{ lines: SalesTemplateLine[] }>()
const { t } = useI18n()
</script>

<template>
  <ol class="flex flex-col gap-2" data-testid="sales-template-lines">
    <li v-if="!props.lines.length" class="text-sm text-muted">{{ t('sales.lines.empty') }}</li>
    <li v-for="(line, index) in props.lines" :key="index" class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-default px-3 py-2" :data-testid="`sales-template-line-${index}`">
      <span v-if="line.kind === 'section'" class="min-w-0 truncate font-semibold text-highlighted">{{ line.name }}</span>
      <span v-else-if="line.kind === 'note'" class="min-w-0 whitespace-pre-wrap text-sm text-muted">{{ line.name }}</span>
      <template v-else>
        <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ line.product?.name }}<span v-if="line.name" class="text-muted"> · {{ line.name }}</span></span>
        <span class="flex shrink-0 items-center gap-2">
          <SharedStatusBadge v-if="!line.usable" tone="warning" :label="t('sales.templates.lineUnusable')" size="sm" data-testid="sales-template-line-unusable" />
          <bdi dir="ltr" class="text-sm text-highlighted">× {{ line.quantity }}</bdi>
        </span>
      </template>
    </li>
  </ol>
</template>
