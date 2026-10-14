<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

const { t } = useI18n()
const { me } = useMe()
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('account.title')" :description="t('account.description')" />
    <SharedPropertiesPanel v-if="me" :title="me.name">
      <SharedPropertyRow :label="t('auth.username')"><bdi dir="ltr">{{ me.login }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('account.company')" :value="me.company.name" />
    </SharedPropertiesPanel>
    <SharedFormSection panel :title="t('account.passwordTitle')">
      <PasswordForm />
    </SharedFormSection>
  </SharedSettingsPage>
</template>
