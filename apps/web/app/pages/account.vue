<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

const { t } = useI18n()
const { me } = useMe()
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('account.title')" :description="t('account.description')" />
    <section v-if="me" class="nasq-panel">
      <div class="nasq-panel-header"><h2 class="text-base font-semibold">{{ me.name }}</h2></div>
      <div class="nasq-panel-body">
        <dl class="nasq-metadata">
          <div><dt>{{ t('auth.username') }}</dt><dd dir="ltr">{{ me.login }}</dd></div>
          <div><dt>{{ t('account.company') }}</dt><dd>{{ me.company.name }}</dd></div>
        </dl>
      </div>
    </section>
    <section class="nasq-panel">
      <div class="nasq-panel-header"><h2 class="text-base font-semibold">{{ t('account.passwordTitle') }}</h2></div>
      <div class="nasq-panel-body">
        <PasswordForm />
      </div>
    </section>
  </SharedPageContainer>
</template>
