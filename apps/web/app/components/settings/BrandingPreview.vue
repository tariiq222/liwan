<script setup lang="ts">
import { createBrandTheme } from '@/utils/brandTheme'
const props = defineProps<{
  name: string
  color: string
  logoUrl: string
}>()

const { t } = useI18n()
const theme = computed(() => createBrandTheme(props.color))
</script>

<template>
  <Card data-testid="branding-preview" :style="theme">
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
        <Button type="button" >
          {{ t('settings.branding.preview.action') }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
