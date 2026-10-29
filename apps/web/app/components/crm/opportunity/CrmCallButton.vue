<script setup lang="ts">
// The call action of a card: a circle button beside the card's link, never inside it (an anchor cannot hold an anchor).
// It stops the click so a row that opens on click does not also navigate.
defineProps<{ phone: string; name: string }>()
const { t } = useI18n()
</script>

<template>
  <UButton :href="`tel:${phone}`" color="neutral" variant="outline" size="sm" square icon="i-lucide-phone" class="shrink-0 rounded-full" :aria-label="t('crm.opportunities.callAction', { name })" data-testid="crm-card-call" @click.stop />
</template>
