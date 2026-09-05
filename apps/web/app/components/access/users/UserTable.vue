<script setup lang="ts">
import type { AdminUserSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'

defineProps<{ users: AdminUserSummary[] }>()
defineEmits<{ open: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div class="overflow-x-auto rounded-lg border">
    <table class="w-full min-w-[700px] text-sm">
      <thead class="border-b bg-muted/30 text-start">
        <tr>
          <th class="p-3 text-start font-medium">{{ t('access.users.columns.name') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.users.columns.login') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.users.columns.employee') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.users.columns.roles') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.users.columns.status') }}</th>
          <th class="p-3 text-end font-medium">{{ t('access.users.columns.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id" class="border-b last:border-0">
          <td class="p-3 font-medium">{{ user.name }}</td>
          <td class="p-3" dir="ltr">{{ user.login }}</td>
          <td class="p-3">{{ user.employee?.name ?? t('access.users.noEmployee') }}</td>
          <td class="p-3">{{ user.assignments.map((assignment) => assignment.role.name.ar).join('، ') || t('access.users.noRoles') }}</td>
          <td class="p-3"><AccessStateBadge :active="user.active" :protected="user.protected" /></td>
          <td class="p-3 text-end">
            <Button variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('open', user.id)">{{ t('access.view') }}</Button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
