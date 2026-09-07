<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { Check, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useAddFollower, useFollowers, useRemoveFollower } from '@/composables/useProjectFollowers'

const props = defineProps<{ project: ProjectDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()

const projectId = computed(() => props.project.id)
const { data: followers } = useFollowers(projectId)
const { mutate: addFollower, isPending: adding } = useAddFollower()
const { mutate: removeFollower, isPending: removing } = useRemoveFollower()

const followerIds = computed(() => new Set((followers.value ?? []).map((f) => f.id)))

function onError(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
}

const open = ref(false)
const q = ref('')
const debouncedQ = refDebounced(q, 250)
const { data: people } = usePeople(debouncedQ)

function addPerson(userId: number) {
  open.value = false
  q.value = ''
  if (followerIds.value.has(userId)) return
  addFollower({ projectId: props.project.id, userId }, { onError })
}

function removePerson(userId: number) {
  removeFollower({ projectId: props.project.id, userId }, { onError })
}
</script>

<template>
  <div class="space-y-3">
    <!-- With "Followers only" visibility, this list is the whole audience for the project — not just people getting notifications. -->
    <p v-if="project.privacy_visibility === 'followers'" class="text-sm text-muted-foreground">{{ t('projects.followers.hint') }}</p>

    <p v-if="(followers ?? []).length === 0" class="text-sm text-muted-foreground">{{ t('projects.followers.empty') }}</p>

    <ul class="space-y-1">
      <li v-for="f in followers ?? []" :key="f.id" data-testid="follower-row" class="flex items-center justify-between rounded-md border p-2 text-sm">
        <span class="truncate">{{ f.name }}</span>
        <Button variant="ghost" size="icon" type="button" :disabled="!hydrated || removing" :aria-label="t('projects.followers.remove')" @click="removePerson(f.id)">
          <X class="size-4" />
        </Button>
      </li>
    </ul>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" type="button" data-testid="follower-add" :disabled="!hydrated || adding">
          {{ t('projects.followers.add') }}
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-64 p-0" align="start">
        <div class="border-b p-2">
          <Input v-model="q" :placeholder="t('app.search')" class="h-8" />
        </div>
        <Command>
          <CommandList>
            <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
            <CommandGroup>
              <CommandItem v-for="p in people ?? []" :key="p.id" :value="String(p.id)" @select="addPerson(p.id)">
                <span class="flex-1">{{ p.name }}</span>
                <Check v-if="followerIds.has(p.id)" class="size-4" />
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>
</template>
