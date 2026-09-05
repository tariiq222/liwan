<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { buildBrandingPatch, normalizeHex } from '@/composables/colorHex'
import { useBrandingAdmin, useUpdateBranding } from '@/composables/useBrandingAdmin'

const MAX_LOGO_BYTES = 1024 * 1024
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg'])

const { t } = useI18n()
const hydrated = useHydrated()
const { data: branding, isLoading } = useBrandingAdmin()
const update = useUpdateBranding()

const name = ref('')
const color = ref('#18181b')
const logo = ref<string | null>(null)
const logoPreview = ref<string | null>(null)
const validationError = ref('')

watch(branding, (value) => {
  if (!value) return
  name.value = value.name
  color.value = value.primary_color
  logo.value = null
  logoPreview.value = null
}, { immediate: true })

const previewName = computed(() => name.value.trim() || branding.value?.name || 'nasq')
const previewColor = computed(() => normalizeHex(color.value) || branding.value?.primary_color || '#18181b')
const previewLogo = computed(() => logoPreview.value || branding.value?.logo_url || '')

function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read_failed'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

async function onLogo(event: Event) {
  validationError.value = ''
  logo.value = null
  logoPreview.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    validationError.value = t('settings.branding.errors.logoFormat')
    input.value = ''
    return
  }
  if (file.size > MAX_LOGO_BYTES) {
    validationError.value = t('settings.branding.errors.logoSize')
    input.value = ''
    return
  }
  try {
    const dataUrl = await readLogo(file)
    const separator = dataUrl.indexOf(',')
    if (separator < 0) throw new Error('invalid_data_url')
    logo.value = dataUrl.slice(separator + 1)
    logoPreview.value = dataUrl
  } catch {
    validationError.value = t('settings.branding.errors.logoRead')
    input.value = ''
  }
}

async function save() {
  validationError.value = ''
  const patch = buildBrandingPatch({
    name: name.value,
    primaryColor: color.value,
    logo: logo.value,
  })
  if (!patch) {
    validationError.value = t('settings.branding.errors.invalid')
    return
  }
  try {
    const saved = await update.mutateAsync(patch)
    name.value = saved.name
    color.value = saved.primary_color
    logo.value = null
    logoPreview.value = null
    toast.success(t('settings.branding.saved'))
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  } finally {
    // A logo can be a 1 MiB base64 mutation variable. Clear TanStack's retained
    // variables after either outcome instead of keeping that payload in memory.
    update.reset()
  }
}

onBeforeUnmount(() => update.reset())
</script>

<template>
  <Skeleton v-if="isLoading" class="h-80 w-full" />
  <div v-else-if="branding" class="grid gap-6 lg:grid-cols-2">
    <form class="space-y-5" data-testid="branding-form" @submit.prevent="save">
      <div class="space-y-2">
        <Label for="branding-name">{{ t('settings.branding.name') }}</Label>
        <Input id="branding-name" v-model="name" data-testid="branding-name" maxlength="100" :disabled="!hydrated || update.isPending.value" />
      </div>
      <div class="space-y-2">
        <Label for="branding-color">{{ t('settings.branding.color') }}</Label>
        <div class="flex gap-2">
          <Input
            id="branding-color"
            v-model="color"
            data-testid="branding-color"
            dir="ltr"
            class="font-mono"
            :disabled="!hydrated || update.isPending.value"
          />
          <input v-model="color" type="color" class="h-9 w-12 rounded border p-1" :disabled="!hydrated || update.isPending.value">
        </div>
      </div>
      <div class="space-y-2">
        <Label for="branding-logo">{{ t('settings.branding.logo') }}</Label>
        <Input
          id="branding-logo"
          data-testid="branding-logo"
          type="file"
          accept="image/png,image/jpeg"
          :disabled="!hydrated || update.isPending.value"
          @change="onLogo"
        />
        <p class="text-xs text-muted-foreground">{{ t('settings.branding.logoHint') }}</p>
      </div>
      <p v-if="validationError" role="alert" class="text-sm text-destructive">{{ validationError }}</p>
      <Button type="submit" data-testid="branding-submit" :disabled="!hydrated || update.isPending.value">
        {{ update.isPending.value ? t('settings.branding.saving') : t('settings.branding.save') }}
      </Button>
    </form>

    <BrandingPreview :name="previewName" :color="previewColor" :logo-url="previewLogo" />
  </div>
</template>
