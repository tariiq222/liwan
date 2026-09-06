<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import type { ProjectDetail, ProjectPatch, Visibility } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { Check } from '@lucide/vue'
import { toast } from 'vue-sonner'
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import TagPicker from '@/components/task/TagPicker.vue'
import { formatCalendarDate, fromCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useUpdateProject } from '@/composables/useProjects'

// Autosaves every field individually via useUpdateProject: no explicit save
// button, each control commits its own patch on blur/Enter/selection.
const props = defineProps<{ project: ProjectDetail }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutate: updateProject } = useUpdateProject()

function patch(body: ProjectPatch) {
  updateProject(
    { id: props.project.id, patch: body },
    { onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')) },
  )
}

// --- name ------------------------------------------------------------------
const nameDraft = ref(props.project.name)
watch(
  () => props.project.name,
  (name) => {
    nameDraft.value = name
  },
)
function commitName() {
  const name = nameDraft.value.trim()
  if (!name || name === props.project.name) {
    nameDraft.value = props.project.name
    return
  }
  patch({ name })
}

// --- description -------------------------------------------------------------
// DescriptionEditor is the task drawer's Tiptap editor, reused as-is: it
// keys its debounced-flush buffer on `taskId`, which here is the project id
// (there's no separate project-scoped variant of the field).
function onDescriptionChange({ html, taskId }: { html: string; taskId: number }) {
  // The editor's debounced flush is keyed by that id: a stale flush from a
  // previously-mounted editor instance (a different task/project id) must
  // not overwrite this project's description.
  if (taskId !== props.project.id) return
  patch({ description: html })
}

// --- manager -----------------------------------------------------------------
const managerOpen = ref(false)
const managerQ = ref('')
const debouncedManagerQ = refDebounced(managerQ, 250)
const { data: people } = usePeople(debouncedManagerQ)

function selectManager(userId: number | null) {
  managerOpen.value = false
  managerQ.value = ''
  if (userId === (props.project.manager?.id ?? null)) return
  patch({ user_id: userId })
}

// --- visibility ----------------------------------------------------------------
function onVisibilityChange(v: unknown) {
  const visibility = v as Visibility
  if (!visibility || visibility === props.project.privacy_visibility) return
  patch({ privacy_visibility: visibility })
}

// --- dates -----------------------------------------------------------------------
// Odoo semantics (ruling, not a guess): PATCH /projects/{id} clears BOTH
// date_start and date on the server whenever either is sent as null, because
// project.project treats the pair as a single range rather than two
// independent fields. The UI mirrors that: setting one edge alone sends only
// that field (the other is left untouched, whatever it currently is), but
// clearing either edge sends {date_start: null, date: null} together and
// shows both as empty afterwards — never a half-cleared range that no longer
// matches what the server actually stored.
const startValue = computed(() => toCalendarDate(props.project.date_start))
const endValue = computed(() => toCalendarDate(props.project.date_end))
const startLabel = computed(() => formatCalendarDate(props.project.date_start, locale.value) || t('projects.settings.noDate'))
const endLabel = computed(() => formatCalendarDate(props.project.date_end, locale.value) || t('projects.settings.noDate'))
const hasAnyDate = computed(() => !!props.project.date_start || !!props.project.date_end)

function onStartChange(v: unknown) {
  const date = fromCalendarDate(v as CalendarDate | undefined)
  if (!date) return
  patch({ date_start: date })
}
function onEndChange(v: unknown) {
  const date = fromCalendarDate(v as CalendarDate | undefined)
  if (!date) return
  patch({ date })
}
function clearDates() {
  patch({ date_start: null, date: null })
}

// --- tags --------------------------------------------------------------------
// TagPicker emits both the bare ids (the PATCH body) and the resolved tag
// objects; the resolved list isn't needed here since useUpdateProject's
// onSuccess replaces the whole cached ProjectDetail with the server response.
type TagRef = ProjectDetail['tags'][number]
function onTagsChange({ ids }: { ids: number[]; resolved: TagRef[] }) {
  patch({ tag_ids: ids })
}
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-2">
      <Label for="project-settings-name">{{ t('projects.settings.name') }}</Label>
      <Input
        id="project-settings-name"
        v-model="nameDraft"
        :disabled="!hydrated"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @blur="commitName"
      />
    </section>

    <section class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label>{{ t('projects.settings.manager') }}</Label>
        <Popover v-model:open="managerOpen">
          <PopoverTrigger as-child>
            <Button variant="outline" class="w-full justify-start" type="button" :disabled="!hydrated">
              {{ project.manager?.name ?? t('projects.settings.noManager') }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-0" align="start">
            <div class="border-b p-2">
              <Input v-model="managerQ" :placeholder="t('app.search')" class="h-8" />
            </div>
            <Command>
              <CommandList>
                <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="none" @select="selectManager(null)">
                    <span class="flex-1">{{ t('projects.settings.noManager') }}</span>
                    <Check v-if="!project.manager" class="size-4" />
                  </CommandItem>
                  <CommandItem v-for="p in people ?? []" :key="p.id" :value="String(p.id)" @select="selectManager(p.id)">
                    <span class="flex-1">{{ p.name }}</span>
                    <Check v-if="project.manager?.id === p.id" class="size-4" />
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div class="space-y-2">
        <Label>{{ t('projects.settings.visibility') }}</Label>
        <Select :model-value="project.privacy_visibility" :disabled="!hydrated" @update:model-value="onVisibilityChange">
          <SelectTrigger class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employees">{{ t('projects.settings.visibilityEmployees') }}</SelectItem>
            <SelectItem value="followers">{{ t('projects.settings.visibilityFollowers') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>

    <!--
      One paired control for the project's date range (see the Odoo-semantics
      comment above): two triggers, each opening its own Calendar popover,
      but both "no date" buttons call the same clearDates() so clearing
      either edge always nulls the pair together, matching the server.
    -->
    <section class="space-y-2">
      <Label>{{ t('projects.settings.dateStart') }} / {{ t('projects.settings.dateEnd') }}</Label>
      <div class="grid grid-cols-2 gap-2">
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" class="justify-start" type="button" :disabled="!hydrated" :aria-label="t('projects.settings.dateStart')">
              {{ startLabel }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar :model-value="startValue" @update:model-value="onStartChange" />
            <div v-if="hasAnyDate" class="border-t p-2">
              <Button variant="ghost" size="sm" type="button" class="w-full" @click="clearDates">{{ t('projects.settings.noDate') }}</Button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" class="justify-start" type="button" :disabled="!hydrated" :aria-label="t('projects.settings.dateEnd')">
              {{ endLabel }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar :model-value="endValue" @update:model-value="onEndChange" />
            <div v-if="hasAnyDate" class="border-t p-2">
              <Button variant="ghost" size="sm" type="button" class="w-full" @click="clearDates">{{ t('projects.settings.noDate') }}</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </section>

    <section class="flex items-center justify-between gap-3">
      <div>
        <Label>{{ t('taskLifecycle.enableDependencies') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('taskLifecycle.enableDependenciesHint') }}</p>
      </div>
      <input
        type="checkbox"
        :checked="project.allow_task_dependencies"
        :disabled="!hydrated || !project.can_manage"
        :aria-label="t('taskLifecycle.enableDependencies')"
        @change="patch({ allow_task_dependencies: ($event.target as HTMLInputElement).checked })"
      />
    </section>

    <section class="space-y-2">
      <Label>{{ t('projects.settings.tags') }}</Label>
      <TagPicker :model-value="project.tags" :can-create="project.can_manage" @update:model-value="onTagsChange" />
    </section>

    <Separator />

    <section class="space-y-2">
      <Label>{{ t('projects.settings.description') }}</Label>
      <DescriptionEditor :model-value="project.description_html" :task-id="project.id" @update:model-value="onDescriptionChange" />
    </section>
  </div>
</template>
