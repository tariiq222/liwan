<script setup lang="ts">
import UserSecurityForm from '@/components/access/users/UserSecurityForm.vue'
import { nextAdminUserSecuritySuccess } from '@/composables/useAdminUsers'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const backTo = computed(() => adminPathWithQuery(`/settings/users/${id.value}`, adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset'])))
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
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('access.users.security')" :back-to="backTo" />
    <p v-if="successKey && !blocked" role="status" class="text-sm nasq-status-text-success">{{ t(successKey) }}</p>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="user.isLoading.value" :error="user.error.value" :empty="!user.data.value" :empty-text="t('access.notFound')" @retry="user.refetch">
      <UserSecurityForm v-if="user.data.value" :user="user.data.value" :on-success-key="setSecuritySuccess" />
    </SharedPageState>
  </SettingsLayout>
</template>
