<script setup lang="ts">
import { computed } from 'vue'
import { createBrandTheme } from '@/utils/brandTheme'

const props = defineProps<{
  name: string
  color: string
  logoUrl: string
}>()

const { t } = useI18n()
const theme = computed(() => createBrandTheme(props.color))
const previewStyle = computed(() => Object.fromEntries(
  Object.entries(theme.value).map(([key, value]) => [`--preview-${key.slice(2)}`, value]),
))
</script>

<template>
  <Card
    data-testid="branding-preview"
    :data-preview-primary="theme['--primary']"
    :style="previewStyle"
  >
    <CardHeader>
      <CardTitle>{{ t('settings.branding.preview.title') }}</CardTitle>
      <CardDescription>{{ t('settings.branding.preview.hint') }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="flex items-center gap-3 rounded-lg border p-4">
        <img v-if="logoUrl" :src="logoUrl" :alt="name" class="size-12 rounded-md object-contain">
        <div v-else class="flex size-12 items-center justify-center rounded-md bg-[var(--preview-primary)] text-lg font-semibold text-[var(--preview-primary-foreground)]">
          {{ name.slice(0, 1) }}
        </div>
        <span class="font-semibold">{{ name }}</span>
      </div>
      <div class="rounded-lg border p-4">
        <Button
          type="button"
          data-testid="branding-preview-action"
          variant="ghost"
          class="branding-preview-action"
        >
          {{ t('settings.branding.preview.action') }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<style scoped>
.branding-preview-action {
  border: 1px solid var(--border);
  background-color: var(--preview-primary);
  color: var(--preview-primary-foreground);
}

.branding-preview-action:hover {
  background-color: var(--preview-primary-hover);
  color: var(--preview-primary-hover-foreground);
}

.branding-preview-action:active {
  background-color: var(--preview-primary-active);
  color: var(--preview-primary-active-foreground);
}
</style>
