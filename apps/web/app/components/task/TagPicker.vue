<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { Check, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useCreateTag, useTags } from '@/composables/useTags'

type TagRef = Task['tags'][number]

// modelValue carries the full ref objects (not just ids), mirroring
// AssigneePicker: the emitted payload gives both the bare ids (for the PATCH
// body) and the resolved objects (for useUpdateTask's optimistic cache
// update).
const props = defineProps<{ modelValue: TagRef[]; canCreate: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [{ ids: number[]; resolved: TagRef[] }] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const open = ref(false)
const q = ref('')
// Debounced: useTags keys its query on the search term, so passing the raw
// input ref fired one request per keystroke.
const debouncedQ = refDebounced(q, 250)
const { data: tags } = useTags(debouncedQ)
const { mutate: createTag, isPending: creating } = useCreateTag()

const selectedIds = computed(() => new Set(props.modelValue.map((tg) => tg.id)))

function isSelected(id: number) {
  return selectedIds.value.has(id)
}

function commit(next: TagRef[]) {
  emit('update:modelValue', { ids: next.map((tg) => tg.id), resolved: next })
}

function toggle(tag: TagRef) {
  commit(isSelected(tag.id) ? props.modelValue.filter((tg) => tg.id !== tag.id) : [...props.modelValue, tag])
}

function remove(id: number) {
  commit(props.modelValue.filter((tg) => tg.id !== id))
}

// No exact (case-insensitive) match in the current search results: offer to
// create a new tag with that name instead.
const trimmedQ = computed(() => q.value.trim())
const hasExactMatch = computed(() => (tags.value ?? []).some((tg) => tg.name.toLowerCase() === trimmedQ.value.toLowerCase()))
const showCreate = computed(() => props.canCreate && trimmedQ.value.length > 0 && !hasExactMatch.value)

function onCreate() {
  const name = trimmedQ.value
  if (!name) return
  createTag(
    { name },
    {
      onSuccess: (tag) => {
        toggle(tag)
        q.value = ''
      },
      onError: (e) => {
        toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
      },
    },
  )
}
</script>

<template>
  <div class="space-y-2" data-testid="tag-picker">
    <div class="flex flex-wrap gap-1">
      <Badge v-for="tag in modelValue" :key="tag.id" variant="outline" class="gap-1 pe-1">
        {{ tag.name }}
        <button
          type="button"
          class="rounded-full hover:bg-muted-foreground/20"
          :aria-label="t('projects.followers.remove')"
          :disabled="!hydrated"
          @click="remove(tag.id)"
        >
          <X class="size-3" />
        </button>
      </Badge>
      <span v-if="modelValue.length === 0" class="text-sm text-muted-foreground">—</span>
    </div>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" type="button" :disabled="!hydrated">{{ t('tasks.drawer.addTag') }}</Button>
      </PopoverTrigger>
      <PopoverContent class="w-64 p-0" align="start">
        <div class="border-b p-2">
          <Input v-model="q" :placeholder="t('app.search')" class="h-8" />
        </div>
        <Command>
          <CommandList>
            <CommandEmpty v-if="!showCreate">{{ t('app.noResults') }}</CommandEmpty>
            <CommandGroup>
              <CommandItem v-for="tag in tags ?? []" :key="tag.id" :value="String(tag.id)" @select="toggle(tag)">
                <span class="flex-1">{{ tag.name }}</span>
                <Check v-if="isSelected(tag.id)" class="size-4" />
              </CommandItem>
              <CommandItem v-if="showCreate" :value="`__create__${trimmedQ}`" :disabled="creating" @select="onCreate">
                {{ t('tasks.drawer.createTag', { name: trimmedQ }) }}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>
</template>
