<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useAddFollower, useFollowers, useRemoveFollower } from '@/composables/useProjectFollowers'

const props = defineProps<{ project: ProjectDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const projectId = computed(() => props.project.id)
const { data: followers } = useFollowers(projectId)
const { mutate: addFollower, isPending: adding } = useAddFollower()
const { mutate: removeFollower, isPending: removing } = useRemoveFollower()

const followerIds = computed(() => new Set((followers.value ?? []).map((f) => f.id)))
const NO_FOLLOWER_SELECTION = undefined

function onError(e: unknown) {
  toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
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
    <p v-if="project.privacy_visibility === 'followers'" class="text-sm text-muted">{{ t('projects.followers.hint') }}</p>

    <p v-if="(followers ?? []).length === 0" class="text-sm text-muted">{{ t('projects.followers.empty') }}</p>

    <ul class="space-y-1">
      <li v-for="f in followers ?? []" :key="f.id" data-testid="follower-row" class="flex items-center justify-between rounded-md border p-2 text-sm">
        <span class="truncate">{{ f.name }}</span>
        <UButton color="neutral" variant="ghost" square type="button" icon="i-lucide-x" :disabled="!hydrated || removing" :aria-label="t('projects.followers.remove')" @click="removePerson(f.id)" />
      </li>
    </ul>

    <USelectMenu
      v-model:open="open"
      v-model:search-term="q"
      :key="followerIds.size"
      :model-value="NO_FOLLOWER_SELECTION"
      :items="people ?? []"
      value-key="id"
      label-key="name"
      class="w-64"
      data-testid="follower-add"
      :placeholder="t('projects.followers.add')"
      :disabled="!hydrated || adding"
      @update:model-value="value => value != null && value !== NO_FOLLOWER_SELECTION && addPerson(value as number)"
    />
  </div>
</template>
