<script setup lang="ts">
import type { CrmSettings } from '@liwan/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'
import { agreeKey } from '@/utils/crmTermForms'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ terms }) => ({ terms }),
  toPatch: ({ terms }) => ({ values: { terms } }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const genders = computed(() => [
  { value: 'm', label: t('crm.settings.terms.masculine') },
  { value: 'f', label: t('crm.settings.terms.feminine') },
])
const groups = computed(() => [
  { key: 'customer', label: t('crm.settings.terms.customer') },
  { key: 'opportunity', label: t('crm.settings.terms.opportunity') },
  { key: 'package', label: t('crm.settings.terms.package') },
] as const)
// The table's columns: one header row on wide screens; each input carries its term and column as its accessible name.
const columns = computed(() => [
  { key: 'arSingular', label: t('crm.settings.terms.arSingular') },
  { key: 'arPlural', label: t('crm.settings.terms.arPlural') },
  { key: 'enSingular', label: t('crm.settings.terms.enSingular') },
  { key: 'enPlural', label: t('crm.settings.terms.enPlural') },
  { key: 'gender', label: t('crm.settings.terms.gender') },
  { key: 'example', label: t('crm.settings.terms.previewLabel') },
])
const nameOf = (term: string, column: string) => `${term}، ${column}`
// The agreement the renamed word gets in the UI language, shown beside the fields so the manager sees the effect.
const preview = (key: 'customer' | 'opportunity' | 'package') => {
  const term = draft.value.terms[key]
  const word = term[locale.value === 'en' ? 'en' : 'ar'].singular
  return t(agreeKey('crm.settings.terms.preview', term.gender), { term: word })
}
</script>

<template>
  <SharedSettingsCard id="terms" v-bind="state" :title="t('crm.settings.terms.title')" :description="t('crm.settings.terms.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <div class="grid gap-4 md:gap-2">
      <div class="hidden gap-3 text-xs font-medium text-muted md:grid md:grid-cols-[7rem_repeat(4,minmax(0,1fr))_8rem_8rem]" aria-hidden="true">
        <span />
        <span v-for="column in columns" :key="column.key">{{ column.label }}</span>
      </div>
      <div v-for="group in groups" :key="group.key" role="group" :aria-labelledby="`terms-${group.key}`" class="grid items-center gap-3 not-first:border-t not-first:border-default not-first:pt-4 md:grid-cols-[7rem_repeat(4,minmax(0,1fr))_8rem_8rem] md:not-first:border-t-0 md:not-first:pt-0">
        <span :id="`terms-${group.key}`" class="text-sm font-medium text-highlighted">{{ group.label }}</span>
        <UFormField :label="columns[0]!.label" :name="`${group.key}-ar-singular`" :ui="{ label: 'md:sr-only' }">
          <UInput :id="`${group.key}-ar-singular`" v-model="draft.terms[group.key].ar.singular" class="w-full" :maxlength="60" :disabled="locked" :aria-label="nameOf(group.label, columns[0]!.label)" />
        </UFormField>
        <UFormField :label="columns[1]!.label" :name="`${group.key}-ar-plural`" :ui="{ label: 'md:sr-only' }">
          <UInput :id="`${group.key}-ar-plural`" v-model="draft.terms[group.key].ar.plural" class="w-full" :maxlength="60" :disabled="locked" :aria-label="nameOf(group.label, columns[1]!.label)" />
        </UFormField>
        <UFormField :label="columns[2]!.label" :name="`${group.key}-en-singular`" :ui="{ label: 'md:sr-only' }">
          <UInput :id="`${group.key}-en-singular`" v-model="draft.terms[group.key].en.singular" class="w-full" dir="ltr" :maxlength="60" :disabled="locked" :aria-label="nameOf(group.label, columns[2]!.label)" />
        </UFormField>
        <UFormField :label="columns[3]!.label" :name="`${group.key}-en-plural`" :ui="{ label: 'md:sr-only' }">
          <UInput :id="`${group.key}-en-plural`" v-model="draft.terms[group.key].en.plural" class="w-full" dir="ltr" :maxlength="60" :disabled="locked" :aria-label="nameOf(group.label, columns[3]!.label)" />
        </UFormField>
        <UFormField :label="columns[4]!.label" :name="`${group.key}-gender`" :ui="{ label: 'md:sr-only' }">
          <USelect :id="`${group.key}-gender`" v-model="draft.terms[group.key].gender" class="w-full" :items="genders" :disabled="locked" :aria-label="nameOf(group.label, columns[4]!.label)" />
        </UFormField>
        <p class="text-sm text-muted"><span class="md:sr-only">{{ columns[5]!.label }}: </span><span class="font-medium text-default">{{ preview(group.key) }}</span></p>
      </div>
      <p class="text-xs text-muted">{{ t('crm.settings.terms.genderHint') }}</p>
    </div>
  </SharedSettingsCard>
</template>
