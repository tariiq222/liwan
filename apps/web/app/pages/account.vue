<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

const { t } = useI18n()
const { me } = useMe()
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-8">
    <SharedPageHeader :title="t('account.title')" :description="t('account.description')" />
    <Card v-if="me" class="rounded-lg border-border/80 bg-card"><CardHeader><CardTitle>{{ me.name }}</CardTitle></CardHeader><CardContent><p dir="ltr" class="text-start text-sm text-muted-foreground">{{ me.login }}</p><p class="mt-2 text-sm text-muted-foreground">{{ me.company.name }}</p></CardContent></Card>
    <Card class="rounded-lg border-border/80 bg-card">
      <CardHeader>
        <CardTitle>{{ t('account.passwordTitle') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <PasswordForm />
      </CardContent>
    </Card>
  </div>
</template>
