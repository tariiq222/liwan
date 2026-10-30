<script setup lang="ts">
import type { AttentionItem } from '@liwan/commercial-contracts'
import { attentionMessage, attentionPresentation } from '@/utils/vendorAttention'
const props = defineProps<{ items: readonly AttentionItem[], now: Date }>()
const { t, te } = useI18n()
const NuxtLink = resolveComponent('NuxtLink')
const duration = (days: number) => t('vendor.today.duration', { count: days }, days)
function sentence(item: AttentionItem) {
  const m = attentionMessage(item, props.now)
  const operation = m.operation ? (te(`vendor.operations.types.${m.operation}`) ? t(`vendor.operations.types.${m.operation}`) : m.operation) : ''
  return t(`vendor.today.kinds.${m.key}`, { duration: m.days === null ? '' : duration(m.days), operation })
}
const rows = computed(() => props.items.map((item, index) => ({ item, index, view: attentionPresentation(item) })))
</script>
<template>
  <ul class="divide-y divide-default rounded-xl ring ring-default" data-slot="attention-list">
    <li v-for="{ item, index, view } in rows" :key="`${item.kind}:${item.operation_id ?? item.invoice_id ?? item.customer_id ?? item.tenant_id}:${index}`" data-testid="attention-item" :data-kind="item.kind">
      <component :is="view.to ? NuxtLink : 'div'" :to="view.to ?? undefined" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 focus-visible:outline-2 focus-visible:outline-primary" :class="view.to ? 'hover:bg-elevated' : ''">
        <UIcon :name="view.icon" class="size-5 shrink-0" :class="view.tone === 'destructive' ? 'text-error' : view.tone === 'warning' ? 'text-warning' : 'text-info'" aria-hidden="true" />
        <span class="min-w-0 flex-1 basis-56">
          <span class="block truncate font-medium text-highlighted"><bdi>{{ item.name }}</bdi></span>
          <span class="block text-sm text-muted">{{ sentence(item) }}</span>
        </span>
        <span v-if="view.to" class="flex items-center gap-1 text-sm font-medium text-primary">{{ t(view.actionKey) }}<UIcon name="i-lucide-arrow-left" class="size-4 ltr:rotate-180" aria-hidden="true" /></span>
      </component>
    </li>
  </ul>
</template>
