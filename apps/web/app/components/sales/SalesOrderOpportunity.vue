<script setup lang="ts">
import type { SalesOrderOpportunity } from '@liwan/contracts'

// The CRM opportunity a quotation was written from (the CRM bridge to Sales): its name, linking to the opportunity page,
// and where it stands. The server sends it only to a caller who reads that opportunity in CRM, so a caller who cannot
// never gets the name; the page shows this panel exactly when the field is there.
const props = defineProps<{ opportunity: SalesOrderOpportunity }>()
const { t } = useI18n()
const TONE = { pending: 'info', won: 'success', lost: 'destructive' } as const
</script>

<template>
  <SharedPropertiesPanel :title="t('sales.record.opportunityPanel')" data-testid="sales-opportunity">
    <SharedPropertyRow :label="t('sales.record.opportunity')">
      <NuxtLink :to="`/crm/opportunities/${props.opportunity.id}`" class="font-semibold text-primary hover:underline" data-testid="sales-opportunity-link">{{ props.opportunity.contact_name }}</NuxtLink>
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('sales.record.opportunityStatusLabel')">
      <span class="flex flex-wrap items-center gap-2">
        <SharedStatusBadge :tone="TONE[props.opportunity.status]" :label="t(`sales.record.opportunityStatus.${props.opportunity.status}`)" size="sm" data-testid="sales-opportunity-status" />
        <SharedStatusBadge v-if="!props.opportunity.active" tone="neutral" :label="t('sales.record.opportunityArchived')" size="sm" />
      </span>
    </SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
