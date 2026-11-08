<script setup lang="ts">
// The call action of a card: a 36px soft square button (it fills with the application colour on hover) beside the card's link, never inside it (an anchor cannot hold an anchor).
// It stops the click so a row that opens on click does not also navigate.
defineProps<{ phone: string; name: string }>()
const { t } = useI18n()
</script>

<template>
  <UButton :href="`tel:${phone}`" color="neutral" variant="soft" square icon="i-lucide-phone" class="size-[36px] shrink-0 bg-elevated text-highlighted hover:bg-(--primary-solid) hover:text-(--primary-solid-foreground)" :aria-label="t('crm.opportunities.callAction', { name })" data-testid="crm-card-call" @click.stop />
</template>
