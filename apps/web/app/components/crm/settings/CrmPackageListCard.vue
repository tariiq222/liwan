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
function rename(row: CrmPackage, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== row.name) void editor.change(row.id, { name })
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
  <SharedFormSection panel :title="t('crm.settings.packages.title')" :description="t('crm.settings.packages.hint')">
    <SharedPageState :loading="query.isLoading.value" :error="query.data.value ? null : query.error.value" :empty="false" @retry="query.refetch">
      <UAlert v-if="editor.message.value" role="alert" color="error" variant="subtle" :title="t('crm.settings.list.saveError')" :description="editor.message.value" />
      <p class="text-sm text-muted">{{ t('crm.settings.packages.count', { count: rows.length, term: termFor('package', rows.length) }) }}</p>
      <ul class="grid gap-3">
        <li v-for="row in rows" :key="row.id" class="grid gap-2 sm:grid-cols-[1fr_9rem_2fr_auto] sm:items-center">
          <UInput :model-value="row.name" :aria-label="t('crm.settings.list.name')" :maxlength="200" :disabled="locked || !row.active" @change="rename(row, $event)" />
          <UInputNumber :model-value="row.price" :min="0" :aria-label="t('crm.settings.packages.price')" :disabled="locked || !row.active" @update:model-value="setPrice(row, $event)" />
          <UInput :model-value="row.description" :placeholder="t('crm.settings.packages.description')" :aria-label="t('crm.settings.packages.description')" :maxlength="2000" :disabled="locked || !row.active" @change="describe(row, $event)" />
          <div class="flex items-center gap-2">
            <UBadge v-if="!row.active" color="neutral" variant="outline" class="rounded-full" :label="t('crm.settings.list.archived')" />
            <UButton v-if="canEdit" type="button" color="neutral" variant="outline" size="sm" :label="row.active ? t('crm.settings.list.archive') : t('crm.settings.list.restore')" :disabled="locked || editor.busy.value.includes(row.id)" @click="editor.change(row.id, { active: !row.active })" />
          </div>
        </li>
      </ul>
      <form v-if="canEdit" class="grid gap-2 sm:grid-cols-[1fr_9rem_2fr_auto] sm:items-center" @submit.prevent="add">
        <UInput v-model="draft.name" :placeholder="t('crm.settings.list.newName')" :aria-label="t('crm.settings.list.newName')" :maxlength="200" :disabled="locked" />
        <UInputNumber v-model="draft.price" :min="0" :aria-label="t('crm.settings.packages.price')" :disabled="locked" />
        <UInput v-model="draft.description" :placeholder="t('crm.settings.packages.description')" :aria-label="t('crm.settings.packages.description')" :maxlength="2000" :disabled="locked" />
        <UButton type="submit" icon="i-lucide-plus" :label="t('crm.settings.list.add')" :loading="editor.busy.value.includes(0)" :disabled="locked || !draft.name.trim()" />
      </form>
    </SharedPageState>
  </SharedFormSection>
</template>
