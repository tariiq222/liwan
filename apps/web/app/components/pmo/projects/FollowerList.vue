<script setup lang="ts">
import type { ProjectDetail } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
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

function onError(e: unknown) {
  toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
}

// Followers are res.users ids; the picker never keeps a selection, it adds on pick.
function addPerson(value: number | number[] | null) {
  const userId = Array.isArray(value) ? value[0] : value
  if (userId == null || followerIds.value.has(userId)) return
  addFollower({ projectId: props.project.id, userId }, { onSuccess: () => toast.add({ title: t('projects.toast.followerAdded'), color: 'success' }), onError })
}

// Removing a follower can take away their access to a followers-only project,
// so it is confirmed inline like every other removal.
const pendingRemoval = ref<number | null>(null)

function removePerson(userId: number) {
  removeFollower({ projectId: props.project.id, userId }, { onSuccess: () => toast.add({ title: t('projects.toast.followerRemoved'), color: 'success' }), onError, onSettled: () => { pendingRemoval.value = null } })
}
</script>

<template>
  <div class="grid gap-3">
    <!-- With "Followers only" visibility, this list is the whole audience for the project — not just people getting notifications. -->
    <p v-if="project.privacy_visibility === 'followers'" class="text-sm text-muted">{{ t('projects.followers.hint') }}</p>

    <p v-if="(followers ?? []).length === 0" class="text-sm text-muted">{{ t('projects.followers.empty') }}</p>

    <ul class="grid gap-2">
      <SharedSubCard v-for="f in followers ?? []" :key="f.id" as="li" data-testid="follower-row" class="grid gap-2 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-2"><SharedPersonAvatar :people="[f]" /><span class="truncate">{{ f.name }}</span></span>
          <UButton v-if="pendingRemoval !== f.id" color="neutral" variant="ghost" square type="button" icon="i-lucide-x" :disabled="!hydrated || removing" :aria-label="t('projects.followers.removeNamed', { name: f.name })" @click="pendingRemoval = f.id" />
        </div>
        <SharedInlineConfirm
          v-if="pendingRemoval === f.id"
          data-testid="follower-remove-confirm"
          :title="t('projects.followers.removeConfirm', { name: f.name })"
          :description="project.privacy_visibility === 'followers' ? t('projects.followers.hint') : undefined"
          :confirm-label="t('projects.followers.remove')"
          :pending="removing"
          @cancel="pendingRemoval = null"
          @confirm="removePerson(f.id)"
        />
      </SharedSubCard>
    </ul>

    <div class="w-64 max-w-full">
      <SharedPersonPicker
        :key="followerIds.size"
        :model-value="null"
        value-key="user_id"
        :exclude="[...followerIds]"
        data-testid="follower-add"
        :placeholder="t('projects.followers.add')"
        :aria-label="t('projects.followers.add')"
        :disabled="adding"
        @update:model-value="addPerson"
      />
    </div>
  </div>
</template>
