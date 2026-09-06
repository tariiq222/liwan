<script setup lang="ts">
import type { PermissionDefinition } from '@nasq/contracts'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const returnTo = computed(() => {
  const query = new URLSearchParams()
  for (const key of ['q', 'status', 'role_id', 'department_id', 'offset']) {
    const value = route.query[key]
    if (value) query.set(key, String(value))
  }
  const suffix = query.toString()
  return `/settings/users${suffix ? `?${suffix}` : ''}`
})
const returnQuery = computed(() => returnTo.value.includes('?') ? `?${returnTo.value.split('?')[1]}` : '')
const accessTo = computed(() => `/settings/users/${id.value}/access${returnQuery.value}`)
const securityTo = computed(() => `/settings/users/${id.value}/security${returnQuery.value}`)
const forbidden = computed(() => !can('access.users.read'))
const query = useAdminUser(id, computed(() => !forbidden.value))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const permissionLabels = computed(() => new Map<string, PermissionDefinition['label']>((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission.label])))
const permissionLabel = (key: string) => permissionLabels.value.get(key)?.[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionLabels.value.get(key)?.ar ?? t('access.roles.unknownPermission')
const sourceLabel = (source: { role: { name: { ar: string; en: string | null } } }) => source.role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? source.role.name.ar
</script>

<template>
  <SettingsLayout><div class="nasq-page-stack mx-auto w-full max-w-[1440px]">
    <SharedPageHeader :title="query.data.value?.name ?? t('access.users.title')" :description="query.data.value?.login" :back-to="returnTo">
      <Button v-if="query.data.value?.allowed_actions.includes('assign_roles')" variant="outline" @click="navigateTo(accessTo)">{{ t('access.users.editAccess') }}</Button>
      <Button v-if="query.data.value?.allowed_actions.includes('reset_password') || query.data.value?.allowed_actions.includes('disable') || query.data.value?.allowed_actions.includes('reactivate')" variant="outline" @click="navigateTo(securityTo)">{{ t('access.users.security') }}</Button>
    </SharedPageHeader>
    <nav class="flex flex-wrap gap-2 rounded-lg border border-border/80 bg-card/70 p-2" :aria-label="t('access.users.accountNavigation')">
      <NuxtLink to="."><Button variant="ghost">{{ t('access.users.account') }}</Button></NuxtLink>
      <NuxtLink v-if="query.data.value?.allowed_actions.includes('assign_roles')" :to="accessTo"><Button variant="ghost">{{ t('access.users.editAccess') }}</Button></NuxtLink>
      <NuxtLink v-if="query.data.value?.allowed_actions.includes('reset_password') || query.data.value?.allowed_actions.includes('disable') || query.data.value?.allowed_actions.includes('reactivate')" :to="securityTo"><Button variant="ghost">{{ t('access.users.security') }}</Button></NuxtLink>
      <NuxtLink v-if="can('access.audit.read')" :to="`/settings/access-log?target_type=user&target_id=${id}`"><Button variant="ghost">{{ t('access.users.changes') }}</Button></NuxtLink>
      <NuxtLink v-if="query.data.value?.employee && can('hr.employees.read')" :to="`/hr/employees/${query.data.value.employee.id}`"><Button variant="ghost">{{ t('access.users.employeeFile') }}</Button></NuxtLink>
    </nav>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" :empty-text="t('access.notFound')" @retry="query.refetch">
      <div v-if="query.data.value" class="grid gap-4 sm:grid-cols-2">
        <Card class="rounded-lg border-border/80 bg-card"><CardHeader><CardTitle>{{ t('access.users.account') }}</CardTitle></CardHeader><CardContent class="space-y-2 text-sm"><p>{{ t('access.users.login') }}: <span dir="ltr">{{ query.data.value.login }}</span></p><p>{{ t('access.users.employee') }}: {{ query.data.value.employee?.name ?? t('access.users.noEmployee') }}</p><AccessStateBadge :active="query.data.value.active" :protected="query.data.value.protected" /></CardContent></Card>
        <Card><CardHeader><CardTitle>{{ t('access.users.rolesAndScopes') }}</CardTitle></CardHeader><CardContent><ul class="space-y-2 text-sm"><li v-for="assignment in query.data.value.assignments" :key="assignment.id"><span class="font-medium">{{ assignment.role.name[locale === 'ar' ? 'ar' : 'en'] ?? assignment.role.name.ar }}</span><span class="block text-xs text-muted-foreground">{{ assignment.scope.name }}</span></li></ul><p v-if="!query.data.value.assignments.length" class="text-sm text-muted-foreground">{{ t('access.users.noRoles') }}</p></CardContent></Card>
        <Card><CardHeader><CardTitle>{{ t('access.users.capabilities') }}</CardTitle></CardHeader><CardContent><ul class="space-y-2 text-sm"><li v-for="capability in query.data.value.capabilities" :key="capability.key">{{ permissionLabel(capability.key) }}<span v-if="capability.sources.length" class="block text-xs text-muted-foreground">{{ capability.sources.map(sourceLabel).join('، ') }}</span></li></ul></CardContent></Card>
      </div>
    </SharedPageState>
  </div></SettingsLayout>
</template>
