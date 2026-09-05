<script setup lang="ts">
defineProps<{
  name: string
  color: string
  logoUrl: string
}>()

const { t } = useI18n()
</script>

<template>
  <Card data-testid="branding-preview" :style="{ '--preview-primary': color }">
    <CardHeader>
      <CardTitle>{{ t('settings.branding.preview.title') }}</CardTitle>
      <CardDescription>{{ t('settings.branding.preview.hint') }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="flex items-center gap-3 rounded-lg border p-4">
        <img :src="logoUrl" :alt="name" class="size-12 rounded-md object-contain">
        <span class="font-semibold">{{ name }}</span>
      </div>
      <div class="rounded-lg border p-4">
        <Button type="button" :style="{ backgroundColor: 'var(--preview-primary)' }">
          {{ t('settings.branding.preview.action') }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
