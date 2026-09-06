<script setup lang="ts">
import UserSecurityForm from '@/components/access/users/UserSecurityForm.vue'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const backTo = computed(() => `/settings/users/${id.value}`)
const forbidden = computed(() => !can('access.users.read'))
const user = useAdminUser(id, computed(() => !forbidden.value))
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-8">
    <SharedPageHeader :title="t('access.users.security')" :back-to="backTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="user.isLoading.value" :error="user.error.value" :empty="!user.data.value" :empty-text="t('access.notFound')" @retry="user.refetch">
      <UserSecurityForm v-if="user.data.value" :user="user.data.value" />
    </SharedPageState>
  </div>
</template>
