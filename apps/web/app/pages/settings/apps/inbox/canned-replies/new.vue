<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import InboxCannedReplyForm from '@/components/inbox/InboxCannedReplyForm.vue'

// Add a canned reply: the route-backed create panel over the inbox settings page.
const DEFAULT_BACK_TO = '/settings/apps/inbox?tab=replies#canned-replies'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const canManage = computed(() => can('inbox.settings.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/inbox']))
</script>

<template>
  <SharedCreatePanel :title="t('inbox.settings.canned.add')" :description="t('inbox.settings.canned.hint')" :back-to="backTo">
    <InboxCannedReplyForm v-if="canManage" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
