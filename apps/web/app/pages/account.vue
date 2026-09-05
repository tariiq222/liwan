<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">{{ t('account.title') }}</h1>
      <p class="mt-1 text-muted-foreground">{{ t('account.description') }}</p>
    </div>
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
