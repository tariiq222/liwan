<script setup lang="ts">
import CompanyMembers from '@/components/access/users/CompanyMembers.vue'
import type { RoleCandidate } from '@/components/access/memberRoles'

// One branch as the root company sees it: the accounts of other companies that are members of the branch, and the way to
// add one by email. This is also how the first member of a new, empty branch is added. It is drawn only in the root company.
// The add opens the members create panel on its own route (Decision 2026-11-27) and returns to this section.
const props = defineProps<{ branch: { id: number; name: string }; roles: RoleCandidate[] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const open = ref(false)
</script>

<template>
  <SharedSubCard as="li" :data-testid="`branch-members-${props.branch.id}`">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium text-highlighted">{{ props.branch.name }}</span>
      <UButton size="sm" color="neutral" variant="outline" :label="t(open ? 'access.members.hide' : 'access.members.manage')" :aria-expanded="open" :disabled="!hydrated" data-testid="branch-members-toggle" @click="open = !open" />
    </div>
    <div v-if="open" class="mt-3 grid gap-3">
      <div><UButton size="sm" icon="i-lucide-user-plus" :label="t('access.members.addMember')" :disabled="!hydrated" data-testid="branch-member-add" :to="{ path: '/settings/team/members/new', query: { company_id: String(props.branch.id), returnTo: '/settings/team/branches#branch-members' } }" /></div>
      <CompanyMembers :roles="props.roles" :company-id="props.branch.id" />
    </div>
  </SharedSubCard>
</template>
