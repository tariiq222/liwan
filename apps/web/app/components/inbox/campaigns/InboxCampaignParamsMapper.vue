<script setup lang="ts">
import { PARAM_SOURCES, paramKey, type ParamRow } from '@/composables/inbox/inboxCampaignParams'

// One row per placeholder of the chosen template: where its value comes from (a fixed text, or a field of each contact)
// and, for a contact field, the fallback used when that contact has none. A contact with neither is skipped.
const rows = defineModel<ParamRow[]>({ required: true })
const props = defineProps<{ disabled?: boolean; invalid?: boolean }>()
const { t } = useI18n()
const sourceItems = computed(() => PARAM_SOURCES.map(value => ({ value, label: t(`inbox.campaigns.params.source.${value}`) })))
const slotLabel = (row: ParamRow) => {
  if (row.location === 'header') return t('inbox.campaigns.params.header')
  if (row.location === 'button') return t('inbox.campaigns.params.button', { name: row.text ?? t('inbox.campaigns.params.copyCode') })
  return t('inbox.campaigns.params.body', { n: row.position })
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="inbox-campaign-params">
    <p v-if="!rows.length" class="text-sm text-muted" data-testid="inbox-campaign-params-none">{{ t('inbox.campaigns.params.none') }}</p>
    <SharedSubCard v-for="row in rows" :key="paramKey(row)" class="grid gap-3 sm:grid-cols-2" :data-testid="`inbox-campaign-param-${paramKey(row).replace(':', '-')}`">
      <p class="text-sm font-medium text-highlighted sm:col-span-2">{{ slotLabel(row) }}</p>
      <UFormField :label="t('inbox.campaigns.params.sourceLabel')">
        <USelect v-model="row.source" :items="sourceItems" class="w-full" :disabled="props.disabled" :aria-label="`${slotLabel(row)}: ${t('inbox.campaigns.params.sourceLabel')}`" />
      </UFormField>
      <UFormField
        :label="row.source === 'static' ? t('inbox.campaigns.params.staticValue') : t('inbox.campaigns.params.fallback')"
        :description="row.source === 'static' ? undefined : t('inbox.campaigns.params.fallbackHint')"
        :required="row.source === 'static'"
        :error="props.invalid && row.source === 'static' && !row.value.trim() ? t('inbox.campaigns.params.valueRequired') : undefined"
      >
        <UInput v-model="row.value" class="w-full" maxlength="1024" :disabled="props.disabled" :aria-label="slotLabel(row)" />
      </UFormField>
    </SharedSubCard>
  </div>
</template>
