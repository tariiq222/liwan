<script setup lang="ts">
import type { ChangeCategory } from '@liwan/contracts'
import { useChangeCategories, useCreateChangeCategory, useUpdateChangeCategory } from '@/composables/useProjectChanges'
import { saveErrorMessage } from '@/utils/formFeedback'

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

const items = computed(() => categories.data.value?.items ?? [])
const newName = ref('')
const resetGeneration = ref(0)
const error = ref('')

async function run(work: () => Promise<unknown>, done: string) {
  error.value = ''
  try {
    await work()
    toast.add({ title: t(done), color: 'success' })
    return true
  }
  catch (cause) {
    error.value = saveErrorMessage(cause, t('errors.generic'), t('errors.saveUncertain'))
    return false
  }
}

async function add() {
  const name = newName.value.trim()
  if (!name || locked.value) return
  if (await run(() => create.mutateAsync({ name, sequence: (items.value.length + 1) * 10 }), 'settings.projects.changeCategories.added')) newName.value = ''
}
async function rename(category: ChangeCategory, name: string) {
  if (locked.value) return
  // A refused rename leaves the row holding the typed text; re-keying it puts the stored name back.
  if (await run(() => update.mutateAsync({ id: category.id, body: { name } }), 'settings.projects.changeCategories.renamed')) return
  resetGeneration.value += 1
}
function toggle(category: ChangeCategory, active: boolean) {
  if (locked.value) return
  void run(() => update.mutateAsync({ id: category.id, body: { active } }), active ? 'settings.projects.changeCategories.restored' : 'settings.projects.changeCategories.archived')
}
</script>

<template>
  <SharedSettingsList
    id="project-change-categories"
    data-testid="change-categories"
    :title="t('settings.projects.changeCategories.title')"
    :description="t('settings.projects.changeCategories.hint')"
    :can-edit="canEdit"
    :message="error"
    :loading="categories.isLoading.value"
    :error="categories.data.value ? null : categories.error.value"
    :empty="!items.length"
    :adding="create.isPending.value"
    :add-disabled="busy || !newName.trim()"
    @retry="categories.refetch"
    @add="add"
  >
    <SharedSettingsListRow
      v-for="category in items"
      :key="`${category.id}-${resetGeneration}`"
      :name="category.name"
      :active="category.active"
      :can-edit="canEdit"
      :busy="busy"
      :data-testid="`change-category-${category.id}`"
      @rename="name => rename(category, name)"
      @toggle="active => toggle(category, active)"
    />
    <template #add>
      <UInput
        v-model="newName"
        class="min-w-40 flex-1"
        data-testid="change-category-new"
        :placeholder="t('app.list.newName')"
        :aria-label="t('settings.projects.changeCategories.name')"
        :maxlength="200"
        :disabled="locked"
      />
    </template>
  </SharedSettingsList>
</template>
