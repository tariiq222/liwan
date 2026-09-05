<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

const { t } = useI18n()
const { me } = useMe()
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">{{ t('account.title') }}</h1>
      <p class="mt-1 text-muted-foreground">{{ t('account.description') }}</p>
    </div>
    <Card v-if="me"><CardHeader><CardTitle>{{ me.name }}</CardTitle></CardHeader><CardContent><p dir="ltr" class="text-start text-sm text-muted-foreground">{{ me.login }}</p><p class="mt-2 text-sm text-muted-foreground">{{ me.company.name }}</p></CardContent></Card>
    <Card>
      <CardHeader>
        <CardTitle>{{ t('account.passwordTitle') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <PasswordForm />
      </CardContent>
    </Card>
  </div>
</template>
