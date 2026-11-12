<script setup lang="ts">
import CompanyMembers from '@/components/access/users/CompanyMembers.vue'
import MemberAddForm from '@/components/access/users/MemberAddForm.vue'
import { offerableRoles, type RoleCandidate } from '@/components/access/memberRoles'

// One branch as the root company sees it: the accounts of other companies that are members of the branch, and the way to
// add one by email. This is also how the first member of a new, empty branch is added. It is drawn only in the root company.
const props = defineProps<{ branch: { id: number; name: string }; roles: RoleCandidate[] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const open = ref(false)
const adding = ref(false)
const addedName = ref('')
function added(name: string) {
  addedName.value = name
  adding.value = false
}
function startAdding() {
  addedName.value = ''
  adding.value = true
}
</script>

<template>
  <SharedSubCard as="li" :data-testid="`branch-members-${props.branch.id}`">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium text-highlighted">{{ props.branch.name }}</span>
      <UButton size="sm" color="neutral" variant="outline" :label="t(open ? 'access.members.hide' : 'access.members.manage')" :aria-expanded="open" :disabled="!hydrated" data-testid="branch-members-toggle" @click="open = !open" />
    </div>
    <div v-if="open" class="mt-3 grid gap-3">
      <UAlert v-if="addedName" role="status" color="success" variant="subtle" icon="i-lucide-user-check" :title="t('access.members.addedTitle', { name: addedName })" />
      <MemberAddForm v-if="adding" :company-id="props.branch.id" :roles="offerableRoles(props.roles, props.branch.id)" @added="added" @cancel="adding = false" />
      <div v-else><UButton size="sm" icon="i-lucide-user-plus" :label="t('access.members.addMember')" :disabled="!hydrated" data-testid="branch-member-add" @click="startAdding" /></div>
      <CompanyMembers :roles="props.roles" :company-id="props.branch.id" />
    </div>
  </SharedSubCard>
</template>
