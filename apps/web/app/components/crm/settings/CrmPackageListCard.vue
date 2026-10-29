<script setup lang="ts">
import { CrmPackageSchema, type CrmPackage } from '@webvue/contracts'
import { useCrmListEditor, useCrmPackages } from '@/composables/crm/useCrmLists'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'

// The packages a sale can pick; the opportunity's value comes from the chosen package.
const props = defineProps<{ canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { termFor } = useCrmTerms()
const query = useCrmPackages()
const editor = useCrmListEditor<CrmPackage, { name: string; price: number; description: string }, { name?: string; price?: number; description?: string; active?: boolean }>('packages', CrmPackageSchema)
const rows = computed(() => query.data.value?.items ?? [])
const draft = reactive({ name: '', price: 0, description: '' })
const locked = computed(() => !hydrated.value || !props.canEdit)
async function add() {
  const name = draft.name.trim()
  if (name && await editor.add({ name, price: draft.price, description: draft.description.trim() })) Object.assign(draft, { name: '', price: 0, description: '' })
}
function describe(row: CrmPackage, event: Event) {
  const description = (event.target as HTMLInputElement).value.trim()
  if (description !== row.description) void editor.change(row.id, { description })
}
const setPrice = (row: CrmPackage, price: number | null | undefined) => {
  if (typeof price === 'number' && price !== row.price) void editor.change(row.id, { price })
}
</script>

<template>
  <SharedSettingsList
    id="packages"
    :title="t('crm.settings.packages.title')"
    :description="t('crm.settings.packages.hint')"
    :can-edit="canEdit"
    :message="editor.message.value"
    :loading="query.isLoading.value"
    :error="query.data.value ? null : query.error.value"
    :empty="!rows.length"
    :adding="editor.busy.value.includes(0)"
    :add-disabled="!draft.name.trim()"
    @retry="query.refetch"
    @add="add"
  >
    <template #before>
      <p class="text-sm text-muted">{{ t('crm.settings.packages.count', { count: rows.length, term: termFor('package', rows.length) }) }}</p>
    </template>
    <SharedSettingsListRow
      v-for="row in rows"
      :key="row.id"
      :name="row.name"
      :active="row.active"
      :can-edit="canEdit"
      :busy="editor.busy.value.includes(row.id)"
      @rename="name => editor.change(row.id, { name })"
      @toggle="active => editor.change(row.id, { active })"
    >
      <UInputNumber :model-value="row.price" class="w-36" :min="0" :aria-label="t('crm.settings.packages.price')" :disabled="locked || !row.active" @update:model-value="setPrice(row, $event)" />
      <UInput :model-value="row.description" class="min-w-48 flex-[2]" :placeholder="t('crm.settings.packages.description')" :aria-label="t('crm.settings.packages.description')" :maxlength="2000" :disabled="locked || !row.active" @change="describe(row, $event)" />
    </SharedSettingsListRow>
    <template #add>
      <UInput v-model="draft.name" class="min-w-40 flex-1" :placeholder="t('app.list.newName')" :aria-label="t('app.list.newName')" :maxlength="200" :disabled="locked" />
      <UInputNumber v-model="draft.price" class="w-36" :min="0" :aria-label="t('crm.settings.packages.price')" :disabled="locked" />
      <UInput v-model="draft.description" class="min-w-48 flex-[2]" :placeholder="t('crm.settings.packages.description')" :aria-label="t('crm.settings.packages.description')" :maxlength="2000" :disabled="locked" />
    </template>
  </SharedSettingsList>
</template>
