<script setup lang="ts">
import type { MembershipCompany } from '@liwan/contracts'

// The step after «this email already has an account in the organisation»: it names the person and where their account
// belongs, and offers the one action that adds that account to this company with the roles already chosen.
const props = defineProps<{ name: string; homeCompany: MembershipCompany; pending?: boolean; error?: string }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-3" data-testid="existing-account-confirm">
    <SharedInlineConfirm
      color="primary"
      :title="t('access.members.existingTitle', { name: props.name, company: props.homeCompany.name })"
      :description="t('access.members.existingBody', { company: props.homeCompany.name })"
      :confirm-label="t('access.members.addToCompany')"
      :cancel-label="t('access.members.backToForm')"
      :pending="props.pending"
      @confirm="emit('confirm')"
      @cancel="emit('cancel')"
    />
    <UAlert v-if="props.error" role="alert" color="error" variant="subtle" :title="props.error" />
  </div>
</template>
