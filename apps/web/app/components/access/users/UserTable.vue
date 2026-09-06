<script setup lang="ts">
import type { AdminUserSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'

defineProps<{ users: AdminUserSummary[] }>()
defineEmits<{ open: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div class="nasq-panel overflow-x-auto">
    <table class="nasq-settings-table">
      <thead class="border-b border-border/80 bg-muted/50 text-start">
        <tr>
          <th class="text-start font-medium">{{ t('access.users.columns.name') }}</th>
          <th class="text-start font-medium">{{ t('access.users.columns.login') }}</th>
          <th class="text-start font-medium">{{ t('access.users.columns.employee') }}</th>
          <th class="text-start font-medium">{{ t('access.users.columns.roles') }}</th>
          <th class="text-start font-medium">{{ t('access.users.columns.status') }}</th>
          <th class="text-end font-medium">{{ t('access.users.columns.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id" class="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/50">
          <td class="font-medium">{{ user.name }}</td>
          <td  dir="ltr">{{ user.login }}</td>
          <td>{{ user.employee?.name ?? t('access.users.noEmployee') }}</td>
          <td>{{ user.assignments.map((assignment) => assignment.role.name.ar).join('، ') || t('access.users.noRoles') }}</td>
          <td><AccessStateBadge :active="user.active" :protected="user.protected" /></td>
          <td class="text-end">
            <Button variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('open', user.id)">{{ t('access.view') }}</Button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
