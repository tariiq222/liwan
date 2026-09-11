<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

const { t } = useI18n()
const { me } = useMe()
</script>

<template>
  <SharedPageContainer width="form" class="space-y-6">
    <SharedPageHeader :title="t('account.title')" :description="t('account.description')" />
    <UCard v-if="me">
      <template #header><h2 class="text-lg font-semibold text-highlighted">{{ me.name }}</h2></template>
      <dl class="grid gap-6 sm:grid-cols-2">
        <div><dt class="text-sm text-muted">{{ t('auth.username') }}</dt><dd class="mt-2 font-medium" dir="ltr">{{ me.login }}</dd></div>
        <div><dt class="text-sm text-muted">{{ t('account.company') }}</dt><dd class="mt-2 font-medium">{{ me.company.name }}</dd></div>
      </dl>
    </UCard>
    <UCard>
      <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('account.passwordTitle') }}</h2></template>
      <PasswordForm />
    </UCard>
  </SharedPageContainer>
</template>
