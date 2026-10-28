<script setup lang="ts">
import { committedName } from '@/utils/crmListRename'
import { CrmLostReasonSchema, CrmSourceSchema, type CrmLostReason, type CrmSource } from '@webvue/contracts'
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
function rename(row: CrmLostReason | CrmSource, event: Event) {
  const name = committedName(event, row.name)
  if (name) void editor.change(row.id, { name })
}
</script>

<template>
  <SharedFormSection panel :title="title" :description="hint">
    <SharedPageState :loading="query.isLoading.value" :error="query.data.value ? null : query.error.value" :empty="false" @retry="query.refetch">
      <UAlert v-if="editor.message.value" role="alert" color="error" variant="subtle" :title="t('crm.settings.list.saveError')" :description="editor.message.value" />
      <ul class="grid gap-2">
        <li v-for="row in rows" :key="row.id" class="flex items-center gap-2">
          <UInput :model-value="row.name" class="min-w-0 flex-1" :aria-label="t('crm.settings.list.name')" :maxlength="200" :disabled="locked || !row.active || isProtected(row) || editor.busy.value.includes(row.id)" @change="rename(row, $event)" />
          <UBadge v-if="isProtected(row)" color="neutral" variant="subtle" class="rounded-full" :label="t('crm.settings.list.protected')" />
          <UBadge v-else-if="!row.active" color="neutral" variant="outline" class="rounded-full" :label="t('crm.settings.list.archived')" />
          <UButton v-if="canEdit && !isProtected(row)" type="button" color="neutral" variant="outline" size="sm" :label="row.active ? t('crm.settings.list.archive') : t('crm.settings.list.restore')" :disabled="locked || editor.busy.value.includes(row.id)" @click="editor.change(row.id, { active: !row.active })" />
        </li>
      </ul>
      <form v-if="canEdit" class="flex items-center gap-2" @submit.prevent="add">
        <UInput v-model="newName" class="min-w-0 flex-1" :placeholder="t('crm.settings.list.newName')" :aria-label="t('crm.settings.list.newName')" :maxlength="200" :disabled="locked" />
        <UButton type="submit" icon="i-lucide-plus" :label="t('crm.settings.list.add')" :loading="editor.busy.value.includes(0)" :disabled="locked || !newName.trim() || editor.busy.value.includes(0)" />
      </form>
    </SharedPageState>
  </SharedFormSection>
</template>
