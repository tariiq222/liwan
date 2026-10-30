<script setup lang="ts">
import type { CrmSettings } from '@liwan/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ discount_allowed, discount_max_percent, price_above_list }) => ({ discount_allowed, discount_max_percent, price_above_list }),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const range = computed(() => props.settings.options.discount_max_percent)
const aboveListItems = computed(() => [
  { value: 'forbid', label: t('crm.settings.pricing.aboveForbid') },
  { value: 'managers', label: t('crm.settings.pricing.aboveManagers') },
  { value: 'everyone', label: t('crm.settings.pricing.aboveEveryone') },
])
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="pricing" v-bind="state" :title="t('crm.settings.pricing.title')" :description="t('crm.settings.pricing.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('crm.settings.pricing.discountAllowed')" :description="t('crm.settings.pricing.discountAllowedHint')">
      <USwitch v-model="draft.discount_allowed" :disabled="locked" :aria-label="t('crm.settings.pricing.discountAllowed')" />
    </UFormField>
    <UFormField orientation="horizontal" v-if="draft.discount_allowed" :label="t('crm.settings.pricing.discountMax')" name="discount-max" :description="t('crm.settings.pricing.discountMaxHint')">
      <UInputNumber id="discount-max" v-model="draft.discount_max_percent" class="w-full" :min="range.min" :max="range.max" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('crm.settings.pricing.aboveList')" name="price-above-list" :description="t('crm.settings.pricing.aboveListHint')">
      <USelect id="price-above-list" v-model="draft.price_above_list" class="w-full" :items="aboveListItems" :disabled="locked" />
    </UFormField>
  </SharedSettingsCard>
</template>
