<script setup lang="ts">
import type { ChangeCategory } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useChangeCategories, useCreateChangeCategory, useUpdateChangeCategory } from '@/composables/useProjectChanges'

// The company's change request categories: added, renamed and archived one row at a time (each change saves
// on its own, like the default stages). An archived category stays on the requests that carry it.
const props = defineProps<{ canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const categories = useChangeCategories(true)
const create = useCreateChangeCategory()
const update = useUpdateChangeCategory()
const busy = computed(() => create.isPending.value || update.isPending.value)
const locked = computed(() => !hydrated.value || !props.canEdit || busy.value)

const newName = ref('')
const editingId = ref<number | null>(null)
const editName = ref('')
const error = ref('')

async function run(work: () => Promise<unknown>, done: string) {
  error.value = ''
  try {
    await work()
    toast.add({ title: t(done), color: 'success' })
    return true
  }
  catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    return false
  }
}

async function add() {
  const name = newName.value.trim()
  if (!name || locked.value) return
  if (await run(() => create.mutateAsync({ name, sequence: ((categories.data.value?.items.length ?? 0) + 1) * 10 }), 'settings.projects.changeCategories.added')) newName.value = ''
}
function startEdit(category: ChangeCategory) {
  editingId.value = category.id
  editName.value = category.name
}
async function saveEdit(category: ChangeCategory) {
  const name = editName.value.trim()
  if (!name || locked.value) return
  if (await run(() => update.mutateAsync({ id: category.id, body: { name } }), 'settings.projects.changeCategories.renamed')) editingId.value = null
}
function toggle(category: ChangeCategory) {
  if (locked.value) return
  void run(() => update.mutateAsync({ id: category.id, body: { active: !category.active } }), category.active ? 'settings.projects.changeCategories.archived' : 'settings.projects.changeCategories.restored')
}
</script>

<template>
  <SharedRecordSection id="project-change-categories" variant="panel" class="liwan-settings-anchor" :title="t('settings.projects.changeCategories.title')" :description="t('settings.projects.changeCategories.hint')">
    <div class="grid gap-4" data-testid="change-categories">
      <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="error" />
      <SharedPageState v-if="categories.error.value" :error="categories.error.value" @retry="categories.refetch" />
      <ul v-else class="grid gap-2">
        <li v-for="category in categories.data.value?.items ?? []" :key="category.id" class="flex flex-wrap items-center gap-2" :data-testid="`change-category-${category.id}`">
          <template v-if="editingId === category.id">
            <UInput v-model="editName" class="min-w-40 flex-1" :aria-label="t('settings.projects.changeCategories.name')" :disabled="locked" @keydown.enter.prevent="saveEdit(category)" />
            <UButton type="button" size="sm" :disabled="locked || !editName.trim()" :label="t('app.save')" @click="saveEdit(category)" />
            <UButton type="button" size="sm" color="neutral" variant="outline" :disabled="busy" :label="t('app.cancel')" @click="editingId = null" />
          </template>
          <template v-else>
            <span class="min-w-40 flex-1 text-sm font-medium" :class="category.active ? 'text-highlighted' : 'text-muted line-through'">{{ category.name }}</span>
            <SharedStatusBadge v-if="!category.active" tone="neutral" :label="t('settings.projects.changeCategories.archivedBadge')" />
            <UButton v-if="canEdit && category.active" type="button" size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :disabled="locked" :aria-label="t('settings.projects.changeCategories.rename', { name: category.name })" @click="startEdit(category)" />
            <UButton v-if="canEdit" type="button" size="sm" color="neutral" variant="ghost" :icon="category.active ? 'i-lucide-archive' : 'i-lucide-archive-restore'" :disabled="locked" :aria-label="t(category.active ? 'settings.projects.changeCategories.archive' : 'settings.projects.changeCategories.restore', { name: category.name })" @click="toggle(category)" />
          </template>
        </li>
      </ul>
      <form v-if="canEdit" class="flex flex-wrap items-center gap-2" @submit.prevent="add">
        <UInput v-model="newName" class="min-w-40 flex-1" data-testid="change-category-new" :placeholder="t('settings.projects.changeCategories.newPlaceholder')" :aria-label="t('settings.projects.changeCategories.newPlaceholder')" :disabled="locked" />
        <UButton type="submit" icon="i-lucide-plus" :disabled="locked || !newName.trim()" :label="t('settings.projects.changeCategories.add')" />
      </form>
    </div>
  </SharedRecordSection>
</template>
