<script setup lang="ts">
import type { AuditEvent } from '@nasq/commercial-contracts'
import { auditSubjectTo } from '@/utils/vendorAudit'
const props = defineProps<{ event: Pick<AuditEvent, 'subject' | 'subject_ref'> }>()
const { t } = useI18n()
const to = computed(() => auditSubjectTo(props.event))
// A named record reads "kind · name"; an unnamed one keeps its kind and shows the stored subject (an account never shows its number alone).
const name = computed(() => props.event.subject_ref.name ?? props.event.subject)
</script>

<template>
  <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <span class="text-muted">{{ t(`vendor.audit.kinds.${event.subject_ref.kind}`) }} ·</span>
    <NuxtLink v-if="to" :to="to" class="text-primary hover:underline" data-testid="audit-subject-link"><bdi>{{ name }}</bdi></NuxtLink>
    <bdi v-else class="break-all">{{ name }}</bdi>
  </span>
</template>
