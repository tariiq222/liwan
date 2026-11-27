<script setup lang="ts">
import BranchPresetCard from '@/components/access/branches/BranchPresetCard.vue'
import BranchPolicyCard from '@/components/access/branches/BranchPolicyCard.vue'
import BranchMembersCard from '@/components/access/branches/BranchMembersCard.vue'
import { ApiError } from '@/composables/useApi'
import { useBranchPolicy, useBranchSeats } from '@/composables/useBranchAccess'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { useMembershipBranches } from '@/composables/useMemberships'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isSubPage = computed(() => normalizedPath.value !== '/settings/team/branches' && normalizedPath.value !== '/settings/team/branches/new')
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const canSeeSeats = computed(() => can('settings.company.manage'))
const canCreate = computed(() => canSeeSeats.value && me.value?.read_only === false)
// Owner decision 2026-10-29, option c: in SaaS a branch is bought, and the paid order creates it.
const purchaseOnly = computed(() => me.value?.commercial?.mode === 'saas')
const hydrated = useHydrated()
const branchSeats = useBranchSeats(computed(() => !isSubPage.value && canSeeSeats.value))
const branchSeatRefused = computed(() => branchSeats.error.value instanceof ApiError && branchSeats.error.value.status === 403)

const forbidden = computed(() => !can('access.users.assign_roles') || !can('access.roles.read'))
const query = useBranchPolicy(computed(() => !isSubPage.value && !forbidden.value))
// The members section lists every branch below the root company, not only the ones the policy names, so the first member of a
// new branch can be added. It stands on its own queries: the policy loading or failing does not hide it. Only the root company
// has branches below it, so in a branch the list is empty and the section is not drawn. The roles are the ones the users pages
// offer, and each card applies the one role rule for its branch.
const canGrant = computed(() => can('access.users.grant'))
const memberBranches = useMembershipBranches(computed(() => !isSubPage.value && canGrant.value))
const memberRoles = useAdminRoles({}, computed(() => !isSubPage.value && canGrant.value && can('access.roles.read')))
const showMembers = computed(() => canGrant.value && (!!memberBranches.error.value || !!memberBranches.data.value?.items.length))
async function reloadPolicy() {
  const result = await query.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage v-if="!isSubPage">
    <SharedPageHeader :title="t('access.branches.title')" back-to="/settings/team" />
    <SharedRecordSection v-if="canSeeSeats && !branchSeatRefused" id="branch-seats" variant="panel" :title="t('access.seats.branchTitle')">
      <SharedPageState :loading="branchSeats.isLoading.value" :error="branchSeats.error.value" @retry="branchSeats.refetch()">
        <div v-if="branchSeats.data.value" class="grid gap-(--liwan-gap-card)">
          <p class="text-sm text-muted">
            {{ t('access.seats.branchUsage', { full: branchSeats.data.value.total - branchSeats.data.value.read_only, limit: branchSeats.data.value.limit ?? t('access.seats.unlimited') }) }}
          </p>
          <p v-if="!branchSeats.data.value.items.length" class="text-sm text-muted">{{ t('access.seats.noBranches') }}</p>
          <ul v-else class="grid gap-(--liwan-gap-card)">
            <SharedSubCard v-for="branch in branchSeats.data.value.items" :key="branch.id" as="li">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="font-medium">{{ branch.name }}</span>
                  <SharedStatusBadge :tone="branch.read_only ? 'warning' : 'success'" :label="t(branch.read_only ? 'access.seats.readOnly' : 'access.seats.full')" />
                </div>
                <UButton v-if="canCreate" :to="`/settings/team/branches/${branch.id}/edit`" size="sm" color="neutral" variant="outline" :disabled="!hydrated">{{ t('access.seats.edit') }}</UButton>
              </div>
            </SharedSubCard>
          </ul>
        </div>
      </SharedPageState>
    </SharedRecordSection>
    <SharedRecordSection v-if="canCreate && purchaseOnly" variant="panel" data-testid="branch-purchase" :title="t('access.branches.create.title')" :description="t('access.branches.create.purchaseDescription')">
      <UButton to="/subscription/branches/new" icon="i-lucide-plus" :disabled="!hydrated">{{ t('access.branches.create.purchase') }}</UButton>
    </SharedRecordSection>
    <SharedRecordSection v-else-if="canCreate" variant="panel" data-testid="branch-create" :title="t('access.branches.create.title')" :description="t('access.branches.create.description')">
      <UButton to="/settings/team/branches/new" icon="i-lucide-plus" :disabled="!hydrated">{{ t('access.branches.create.action') }}</UButton>
    </SharedRecordSection>
    <SharedForbiddenState v-if="forbidden && !canCreate" :description="t('access.forbidden')" />
    <SharedPageState v-else-if="!forbidden" :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <!-- Keyed by the signed-in user and company, so a draft never outlives the identity it was made for. -->
      <div v-if="query.data.value" :key="identity ?? ''" class="grid gap-(--liwan-gap-card)">
        <BranchPresetCard :policy="query.data.value" :reload-policy="reloadPolicy" />
        <BranchPolicyCard :policy="query.data.value" :reload-policy="reloadPolicy" />
      </div>
    </SharedPageState>
    <!-- Keyed by the signed-in user and company, so a draft never outlives the identity it was made for. -->
    <SharedRecordSection v-if="showMembers" id="branch-members" :key="`members-${identity ?? ''}`" variant="panel" :title="t('access.members.branchTitle')" :description="t('access.members.branchDescription')">
      <SharedPageState :loading="memberBranches.isLoading.value" :error="memberBranches.error.value" @retry="memberBranches.refetch()">
        <ul class="grid gap-(--liwan-gap-card)">
          <BranchMembersCard v-for="branch in memberBranches.data.value?.items ?? []" :key="branch.id" :branch="branch" :roles="memberRoles.data.value?.items ?? []" />
        </ul>
      </SharedPageState>
    </SharedRecordSection>
  </SharedSettingsPage>
  <NuxtPage />
</template>
