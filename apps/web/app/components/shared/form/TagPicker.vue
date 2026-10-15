<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { useCreateTag, useTags } from '@/composables/useTags'

type TagRef = Task['tags'][number]

// modelValue carries the full ref objects (not just ids), mirroring
// AssigneePicker: the emitted payload gives both the bare ids (for the PATCH
// body) and the resolved objects (for useUpdateTask's optimistic cache
// update).
const props = defineProps<{ modelValue: TagRef[]; canCreate: boolean; labelledby?: string }>()
const emit = defineEmits<{ 'update:modelValue': [{ ids: number[]; resolved: TagRef[] }] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const q = ref('')
// Debounced: useTags keys its query on the search term, so passing the raw
// input ref fired one request per keystroke.
const debouncedQ = refDebounced(q, 250)
const { data: tags } = useTags(debouncedQ)
const { mutate: createTag, isPending: creating } = useCreateTag()

const selectedIds = computed(() => new Set(props.modelValue.map((tg) => tg.id)))

function commit(next: TagRef[]) {
  emit('update:modelValue', { ids: next.map((tg) => tg.id), resolved: next })
}

function remove(id: number) {
  commit(props.modelValue.filter((tg) => tg.id !== id))
}

// No exact (case-insensitive) match in the current search results: offer to
// create a new tag with that name instead.
const trimmedQ = computed(() => q.value.trim())
const hasExactMatch = computed(() => (tags.value ?? []).some((tg) => tg.name.toLowerCase() === trimmedQ.value.toLowerCase()))
const showCreate = computed(() => props.canCreate && trimmedQ.value.length > 0 && !hasExactMatch.value)

const tagItems = computed(() => (tags.value ?? []).map((tg) => ({ label: tg.name, value: tg.id })))

function onSelectMenuChange(ids: number[]) {
  const byId = new Map<number, TagRef>()
  for (const tg of props.modelValue) byId.set(tg.id, tg)
  for (const tg of tags.value ?? []) byId.set(tg.id, tg)
  commit(ids.map((id) => byId.get(id)).filter((tg): tg is TagRef => !!tg))
}

function onCreateItem() {
  const name = trimmedQ.value
  if (!showCreate.value || !name || creating.value) return
  createTag(
    { name },
    {
      onSuccess: (tag) => {
        commit([...props.modelValue, tag])
        q.value = ''
      },
      onError: (e) => {
        toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
      },
    },
  )
}
</script>

<template>
  <div class="space-y-2" data-testid="tag-picker">
    <div v-if="modelValue.length" class="flex flex-wrap gap-1">
      <UBadge v-for="tag in modelValue" :key="tag.id" variant="outline" class="min-w-0 max-w-full gap-1 pe-1">
        <span class="min-w-0 max-w-full truncate" :title="tag.name">{{ tag.name }}</span>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          square
          size="xs"
          class="rounded-full hover:bg-elevated/50"
          :aria-label="t('projects.followers.remove')"
          :disabled="!hydrated"
          @click="remove(tag.id)"
        >
          <UIcon name="i-lucide-x" class="size-3" aria-hidden="true" />
        </UButton>
      </UBadge>
    </div>

    <USelectMenu
      v-model:search-term="q"
      :model-value="[...selectedIds]"
      :items="tagItems"
      :ignore-filter="true"
      :create-item="showCreate ? { position: 'bottom', when: 'always' } : false"
      multiple
      value-key="value"
      variant="outline"
      size="sm"
      class="w-full"
      :disabled="!hydrated"
      :placeholder="t('tasks.drawer.addTag')"
      :search-input="{ placeholder: t('app.search') }"
      :aria-labelledby="props.labelledby"
      @update:model-value="onSelectMenuChange"
      @create="onCreateItem"
    >
        <template #default><span class="truncate">{{ modelValue.length ? modelValue.map(tag => tag.name).join('، ') : t('tasks.drawer.addTag') }}</span></template>
      <template v-if="showCreate" #create-item-label>
        {{ t('tasks.drawer.createTag', { name: trimmedQ }) }}
      </template>
    </USelectMenu>
  </div>
</template>
