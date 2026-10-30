<script setup lang="ts">
import { CrmLostReasonSchema, CrmSourceSchema, type CrmLostReason, type CrmSource } from '@liwan/contracts'
import { useCrmListEditor, useCrmLostReasons, useCrmSources } from '@/composables/crm/useCrmLists'

// A list of names that can be added, renamed, archived and restored: the lost reasons and the sources.
const props = defineProps<{ kind: 'lost-reasons' | 'sources'; title: string; hint: string; canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const query = props.kind === 'sources' ? useCrmSources() : useCrmLostReasons()
const editor = useCrmListEditor<CrmLostReason | CrmSource, { name: string }, { name?: string; active?: boolean }>(
  props.kind, props.kind === 'sources' ? CrmSourceSchema : CrmLostReasonSchema,
)
const rows = computed<Array<CrmLostReason | CrmSource>>(() => query.data.value?.items ?? [])
const newName = ref('')
const locked = computed(() => !hydrated.value || !props.canEdit)
const isProtected = (row: CrmLostReason | CrmSource) => 'protected' in row && row.protected
async function add() {
  const name = newName.value.trim()
  if (name && await editor.add({ name })) newName.value = ''
}
</script>

<template>
  <SharedSettingsList
    :id="kind === 'sources' ? 'sources' : 'lostReasons'"
    :title="title"
    :description="hint"
    :can-edit="canEdit"
    :message="editor.message.value"
    :loading="query.isLoading.value"
    :error="query.data.value ? null : query.error.value"
    :empty="!rows.length"
    :adding="editor.busy.value.includes(0)"
    :add-disabled="!newName.trim()"
    @retry="query.refetch"
    @add="add"
  >
    <SharedSettingsListRow
      v-for="row in rows"
      :key="row.id"
      :name="row.name"
      :active="row.active"
      :locked="isProtected(row)"
      :can-edit="canEdit"
      :busy="editor.busy.value.includes(row.id)"
      @rename="name => editor.change(row.id, { name })"
      @toggle="active => editor.change(row.id, { active })"
    />
    <template #add>
      <UInput v-model="newName" class="min-w-40 flex-1" :placeholder="t('app.list.newName')" :aria-label="t('app.list.newName')" :maxlength="200" :disabled="locked" />
    </template>
  </SharedSettingsList>
</template>
