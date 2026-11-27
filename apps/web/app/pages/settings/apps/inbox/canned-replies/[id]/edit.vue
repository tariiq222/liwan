<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import InboxCannedReplyForm from '@/components/inbox/InboxCannedReplyForm.vue'
import { useInboxCannedReplies } from '@/composables/inbox/useInbox'

// Edit one canned reply shortcut and body.
const DEFAULT_BACK_TO = '/settings/apps/inbox?tab=replies#canned-replies'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('inbox.settings.manage'))
const id = computed(() => {
  const raw = typeof route.params.id === 'string' ? route.params.id : ''
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/inbox']))
const query = useInboxCannedReplies(() => canManage.value && id.value !== null)
const reply = computed(() => (id.value === null ? null : query.data.value?.items.find(item => item.id === id.value) ?? null))
const loading = computed(() => id.value !== null && query.isPending.value)
const error = computed(() => {
  if (id.value === null) return { status: 404 }
  if (query.error.value) return query.error.value
  if (!query.isPending.value && query.data.value && !reply.value) return { status: 404 }
  return null
})
function retry() {
  if (!hydrated.value) return
  void query.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('inbox.settings.canned.editTitle')" :back-to="backTo" :back-label="t('inbox.settings.canned.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <SharedFormSection v-if="reply" panel>
        <InboxCannedReplyForm :key="reply.id" :reply="reply" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
