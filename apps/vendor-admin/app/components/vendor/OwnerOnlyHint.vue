<script setup lang="ts">
import { ownerOnlyTextKey, type OwnerOnlyAction } from '@/utils/ownerOnly'
// Said to an account that holds only one of the two grants an owner-only action needs (see utils/ownerOnly.ts).
defineProps<{ action: OwnerOnlyAction }>()
const { t } = useI18n()
</script>
<template>
  <UAlert color="neutral" variant="subtle" icon="i-lucide-lock" :title="t(ownerOnlyTextKey(action))" data-slot="owner-only-hint" :data-action="action" />
</template>
