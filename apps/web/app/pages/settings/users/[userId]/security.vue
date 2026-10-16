<script setup lang="ts">
import UserSecurityForm from '@/components/access/users/UserSecurityForm.vue'
import { nextAdminUserSecuritySuccess } from '@/composables/useAdminUsers'
import { recordParentTo } from '@/utils/recordListOrigin'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const sourcePaths = useRecordListPaths(['/settings/users'])
const backTo = computed(() => recordParentTo(`/settings/users/${id.value}`, route.query, sourcePaths.value, route.hash))
const forbidden = computed(() => !can('access.users.read'))
const user = useAdminUser(id, computed(() => !forbidden.value))
const successKey = ref('')
const blocked = computed(() => forbidden.value || !!user.error.value)
function setSecuritySuccess(reportedUserId: number, key: string) {
  const next = nextAdminUserSecuritySuccess(id.value, reportedUserId, key, blocked.value)
  if (next === undefined) return
  successKey.value = next
}
watch([id, blocked], () => { successKey.value = '' })
onBeforeUnmount(() => { successKey.value = '' })
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.users.security')" :back-to="backTo" />
    <p v-if="successKey && !blocked" role="status" class="text-sm text-success">{{ t(successKey) }}</p>
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="user.isLoading.value" :error="user.error.value" :empty="!user.data.value" :empty-text="t('access.notFound')" @retry="user.refetch">
      <UserSecurityForm v-if="user.data.value" :user="user.data.value" :on-success-key="setSecuritySuccess" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
