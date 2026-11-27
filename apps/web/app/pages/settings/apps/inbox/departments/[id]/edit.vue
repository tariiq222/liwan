<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import InboxDepartmentForm from '@/components/inbox/InboxDepartmentForm.vue'
import InboxDepartmentHours from '@/components/inbox/InboxDepartmentHours.vue'
import { useInboxDepartments } from '@/composables/inbox/useInboxSettings'

// Edit one department (name, members, and optionally its own working hours).
const DEFAULT_BACK_TO = '/settings/apps/inbox?tab=basics#departments'
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
const query = useInboxDepartments(() => canManage.value && id.value !== null)
const department = computed(() => (id.value === null ? null : query.data.value?.items.find(item => item.id === id.value) ?? null))
const loading = computed(() => id.value !== null && query.isPending.value)
const error = computed(() => {
  if (id.value === null) return { status: 404 }
  if (query.error.value) return query.error.value
  if (!query.isPending.value && query.data.value && !department.value) return { status: 404 }
  return null
})
function retry() {
  if (!hydrated.value) return
  void query.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('inbox.settings.departments.editTitle')" :back-to="backTo" :back-label="t('inbox.settings.departments.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <div v-if="department" class="grid gap-(--liwan-gap-card)">
        <SharedFormSection panel>
          <InboxDepartmentForm :key="department.id" :department="department" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
        </SharedFormSection>
        <SharedRecordSection v-if="can('inbox.automation.manage')" variant="panel" :title="t('inbox.automation.hours.title')">
          <InboxDepartmentHours :department-id="department.id" />
        </SharedRecordSection>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
