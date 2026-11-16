<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { HelpdeskCategoryResource, HelpdeskResource } from '@liwan/contracts'
import { useSaveHelpdeskResource, type HelpdeskResourceKind } from '@/composables/helpdesk/useHelpdeskResources'

// One value list of the support settings (categories, tags, channels or types): rename inline, archive, and add a row.
// Categories keep a parent so a tenant can build the tree its sector uses; the server refuses a cycle.
const props = defineProps<{
  kind: Exclude<HelpdeskResourceKind, 'teams' | 'stages'>
  rows: (HelpdeskResource | HelpdeskCategoryResource)[]
  canEdit: boolean
}>()
const { t } = useI18n()
const save = useSaveHelpdeskResource(props.kind)
const editing = ref<number | null>(null)
const name = ref('')
const parentId = ref<number | null>(null)
const adding = ref(false)
const failure = ref<string | null>(null)

const isCategories = computed(() => props.kind === 'categories')
const parentItems = computed(() => [
  { value: 0, label: t('helpdesk.settings.values.noParent') },
  ...(props.rows as HelpdeskCategoryResource[]).map(row => ({ value: row.id, label: row.name })),
])
const parentOf = (row: HelpdeskResource | HelpdeskCategoryResource) =>
  (row as HelpdeskCategoryResource).parent_id ?? null

function start(row?: HelpdeskResource | HelpdeskCategoryResource) {
  failure.value = null
  adding.value = !row
  editing.value = row?.id ?? null
  name.value = row?.name ?? ''
  parentId.value = row ? parentOf(row) : null
}

function cancel() {
  editing.value = null
  adding.value = false
  failure.value = null
}

async function submit(row?: HelpdeskResource | HelpdeskCategoryResource) {
  failure.value = null
  try {
    await save.mutateAsync({
      ...(row ? { id: row.id } : {}),
      name: name.value.trim(),
      ...(isCategories.value ? { parent_id: parentId.value ?? false } : {}),
    })
    cancel()
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}

async function archive(row: HelpdeskResource | HelpdeskCategoryResource, active: boolean) {
  failure.value = null
  try {
    await save.mutateAsync({ id: row.id, name: row.name, active })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}
const title = computed(() => t(`helpdesk.settings.values.${props.kind}.title`))
const addLabel = computed(() => t(`helpdesk.settings.values.${props.kind}.add`))
</script>

<template>
  <SharedSubCard :title="title" :data-testid="`helpdesk-settings-${props.kind}`">
    <template #actions>
      <UButton v-if="props.canEdit && !adding && editing === null" color="neutral" variant="outline" icon="i-lucide-plus" size="xs" :label="addLabel" :data-testid="`helpdesk-${props.kind}-add`" @click="start()" />
    </template>
    <p v-if="failure" class="mb-2 text-sm text-error" role="alert" :data-testid="`helpdesk-${props.kind}-error`">{{ failure }}</p>
    <ul class="flex flex-col divide-y divide-default">
      <li v-for="row in props.rows" :key="row.id" class="flex items-center justify-between gap-2 py-1.5" :data-testid="`helpdesk-${props.kind}-${row.id}`">
        <span class="min-w-0 truncate text-sm text-highlighted">{{ row.name }}</span>
        <div class="flex items-center gap-2">
          <SharedStatusBadge v-if="!row.active" tone="neutral" :label="t('helpdesk.settings.resources.archived')" size="sm" />
          <UButton v-if="props.canEdit" color="neutral" variant="ghost" icon="i-lucide-pencil" size="xs" :aria-label="t('app.edit')" @click="start(row)" />
          <USwitch v-if="props.canEdit" :model-value="row.active" :aria-label="t('helpdesk.settings.resources.active')" :disabled="save.isPending.value" @update:model-value="value => archive(row, value === true)" />
        </div>
      </li>
    </ul>
    <form v-if="props.canEdit && (adding || editing !== null)" class="mt-3 flex flex-wrap items-end gap-2" :data-testid="`helpdesk-${props.kind}-form`" @submit.prevent="submit(props.rows.find(row => row.id === editing))">
      <UFormField :label="t('helpdesk.settings.resources.name')" required class="min-w-40 grow">
        <UInput v-model="name" class="w-full" :maxlength="64" :data-testid="`helpdesk-${props.kind}-name`" />
      </UFormField>
      <UFormField v-if="isCategories" :label="t('helpdesk.settings.values.parent')" class="min-w-40">
        <USelect :model-value="parentId ?? 0" :items="parentItems" class="w-full" @update:model-value="value => { parentId = Number(value) || null }" />
      </UFormField>
      <div class="flex gap-2">
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="save.isPending.value" @click="cancel" />
        <UButton type="submit" :loading="save.isPending.value" :label="t('helpdesk.settings.resources.save')" :data-testid="`helpdesk-${props.kind}-save`" />
      </div>
    </form>
  </SharedSubCard>
</template>
