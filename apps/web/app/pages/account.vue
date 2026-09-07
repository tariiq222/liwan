<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

const { t } = useI18n()
const { me } = useMe()
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('account.title')" :description="t('account.description')" />
    <Card v-if="me" class="nasq-panel"><CardHeader class="nasq-panel-header"><CardTitle>{{ me.name }}</CardTitle></CardHeader><CardContent class="nasq-panel-body"><dl class="nasq-metadata"><div><dt>{{ t('auth.username') }}</dt><dd dir="ltr">{{ me.login }}</dd></div><div><dt>{{ t('account.company') }}</dt><dd>{{ me.company.name }}</dd></div></dl></CardContent></Card>
    <Card class="nasq-panel">
      <CardHeader>
        <CardTitle>{{ t('account.passwordTitle') }}</CardTitle>
      </CardHeader>
      <CardContent class="nasq-panel-body">
        <PasswordForm />
      </CardContent>
    </Card>
  </SharedPageContainer>
</template>
