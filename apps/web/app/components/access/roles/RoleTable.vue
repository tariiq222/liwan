<script setup lang="ts">
import type { RoleSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'

defineProps<{ roles: RoleSummary[]; canManage?: boolean }>()
defineEmits<{ open: [id: number]; clone: [id: number] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
</script>

<template>
  <div class="nasq-panel overflow-x-auto">
    <table class="nasq-settings-table">
      <thead class="border-b border-border/80 bg-muted/50">
        <tr>
          <th class="text-start font-medium">{{ t('access.roles.columns.name') }}</th>
          <th class="text-start font-medium">{{ t('access.roles.columns.description') }}</th>
          <th class="text-start font-medium">{{ t('access.roles.columns.type') }}</th>
          <th class="text-start font-medium">{{ t('access.roles.columns.users') }}</th>
          <th class="text-start font-medium">{{ t('access.roles.columns.status') }}</th>
          <th class="text-end font-medium">{{ t('access.roles.columns.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in roles" :key="role.id" class="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/50">
          <td class="font-medium">{{ roleLabel(role) }}</td>
          <td class="max-w-xs">{{ role.description }}</td>
          <td>{{ role.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom') }}</td>
          <td>{{ role.user_count }}</td>
          <td><AccessStateBadge :active="role.active" :protected="role.protected" /></td>
          <td class="text-end"><div class="flex justify-end gap-1">
            <Button variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('open', role.id)">{{ t('access.view') }}</Button>
            <Button v-if="canManage" variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('clone', role.id)">{{ t('access.roles.clone') }}</Button>
          </div></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
