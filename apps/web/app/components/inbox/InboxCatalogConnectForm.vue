<script setup lang="ts">
import { InboxCatalogCreateSchema, type InboxCatalog } from '@liwan/contracts'
import { useCreateInboxCatalog } from '@/composables/inbox/useInboxCatalog'
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'

// Connects the catalog made in Commerce Manager to a WhatsApp business account: the number to use, the catalog's id
// (pasted from Commerce Manager), whether LiwanOS connects it to the account through the API, and the defaults every
// product gets (brand, product link, whether prices include VAT). The server checks the catalog with Meta.
const props = defineProps<{ backTo: string }>()
const emit = defineEmits<{ saved: [catalog: InboxCatalog] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const channels = useInboxChannels()
const { mutateAsync: create, isPending } = useCreateInboxCatalog()
const channelId = ref<number | undefined>(undefined)
const metaCatalogId = ref('')
const connect = ref(true)
const brand = ref('')
const link = ref('')
const includeTax = ref(true)
const attempted = ref(false)
const saved = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const channelItems = computed(() => (channels.data.value?.items ?? []).map(item => ({ value: item.id, label: item.name })))
const body = computed(() => ({
  channel_id: channelId.value, meta_catalog_id: metaCatalogId.value.trim(), connect: connect.value, brand: brand.value.trim(),
  default_link: link.value.trim() || null, prices_include_tax: includeTax.value,
}))
const parsed = computed(() => InboxCatalogCreateSchema.safeParse(body.value))
const dirty = computed(() => !saved.value && (!!metaCatalogId.value.trim() || !!link.value.trim() || channelId.value !== undefined))
const off = computed(() => !hydrated.value || isPending.value)
const invalid = (field: string) => parsed.value.error?.issues.some(issue => issue.path[0] === field)
const fieldError = (field: string, key: string) => serverError.value?.field === field ? serverError.value.message : attempted.value && invalid(field) ? t(`inbox.catalog.connect.invalid.${key}`) : undefined

async function submit() {
  attempted.value = true
  serverError.value = null
  if (off.value || !parsed.value.success) return
  try {
    const catalog = await create(parsed.value.data)
    saved.value = true
    toast.add({ title: t('inbox.catalog.connect.done'), color: 'success' })
    emit('saved', catalog)
  } catch (e) {
    serverError.value = { field: (e as { field?: string }).field, message: e instanceof Error ? e.message : t('errors.generic') }
    toast.add({ title: serverError.value.message, color: 'error' })
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate data-testid="inbox-catalog-connect" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UFormField :label="t('inbox.catalog.connect.channel')" :description="t('inbox.catalog.connect.channelHint')" required :error="fieldError('channel_id', 'channel')">
      <USelect v-model="channelId" :items="channelItems" class="w-full" :placeholder="t('inbox.catalog.connect.pickChannel')" :disabled="off" data-testid="inbox-catalog-channel" />
    </UFormField>
    <UFormField :label="t('inbox.catalog.connect.catalogId')" :description="t('inbox.catalog.connect.catalogIdHint')" required :error="fieldError('meta_catalog_id', 'catalogId')">
      <UInput v-model="metaCatalogId" class="w-full" dir="ltr" inputmode="numeric" autocomplete="off" :disabled="off" data-testid="inbox-catalog-id" />
    </UFormField>
    <label class="flex items-start gap-3 text-sm">
      <USwitch v-model="connect" class="mt-0.5" :disabled="off" data-testid="inbox-catalog-connect-switch" />
      <span><span class="block font-medium text-highlighted">{{ t('inbox.catalog.connect.connectForMe') }}</span><span class="block text-xs text-muted">{{ t('inbox.catalog.connect.connectForMeHint') }}</span></span>
    </label>
    <UAlert color="info" variant="subtle" icon="i-lucide-key-round" :description="t('inbox.catalog.connect.permissionHelp')" />
    <UFormField :label="t('inbox.catalog.brand')" :description="t('inbox.catalog.brandHint')" required :error="fieldError('brand', 'brand')">
      <UInput v-model="brand" class="w-full" maxlength="100" :disabled="off" data-testid="inbox-catalog-brand" />
    </UFormField>
    <UFormField :label="t('inbox.catalog.defaultLink')" :description="t('inbox.catalog.defaultLinkHint')" :error="fieldError('default_link', 'link')">
      <UInput v-model="link" class="w-full" dir="ltr" type="url" placeholder="https://" :disabled="off" data-testid="inbox-catalog-link" />
    </UFormField>
    <label class="flex items-start gap-3 text-sm">
      <USwitch v-model="includeTax" class="mt-0.5" :disabled="off" />
      <span><span class="block font-medium text-highlighted">{{ t('inbox.catalog.pricesIncludeTax') }}</span><span class="block text-xs text-muted">{{ t('inbox.catalog.pricesIncludeTaxHint') }}</span></span>
    </label>
    <div class="flex justify-end gap-2">
      <UButton :to="props.backTo" color="neutral" variant="outline" :disabled="off" :label="t('app.cancel')" />
      <UButton type="submit" :disabled="off" :loading="isPending" :label="t('inbox.catalog.connect.submit')" data-testid="inbox-catalog-connect-submit" />
    </div>
  </form>
</template>
