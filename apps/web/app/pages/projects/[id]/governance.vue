<script setup lang="ts">
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { hasCapability } from '@/utils/accessPolicy'

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const projectId = computed(() => projectIdFromPath(route.path))
// All four sections are governed by the same capability, so the guard belongs
// to the list rather than to each card.
const canRead = computed(() => hasCapability(me.value, 'pmo.projects.read'))

// The frame renders the project name as the page's only h1, so this page
// registers the shell title without emitting a competing heading.
usePageHeader(() => t('projects.workspace.groups.governance'))

const cards = [
  { id: 'charter', labelKey: 'nav.projectCharter', descriptionKey: 'projects.governance.charterHint', icon: 'i-lucide-file-text', segment: 'charter' },
  { id: 'stakeholders', labelKey: 'nav.projectStakeholders', descriptionKey: 'projects.governance.stakeholdersHint', icon: 'i-lucide-users', segment: 'stakeholders' },
  { id: 'raci', labelKey: 'projects.workspace.sections.raci', descriptionKey: 'projects.governance.raciHint', icon: 'i-lucide-grid-3x3', segment: 'raci' },
  { id: 'risks', labelKey: 'nav.projectRisks', descriptionKey: 'projects.governance.risksHint', icon: 'i-lucide-circle-alert', segment: 'register' },
]
</script>

<template>
  <SharedPageContainer width="list">
    <div v-if="canRead" class="grid gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="card in cards"
        :key="card.id"
        :to="`/projects/${projectId}/${card.segment}`"
        class="rounded-lg ring ring-default bg-default overflow-hidden flex items-start gap-3 p-4 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :data-testid="`governance-card-${card.id}`"
      >
        <UIcon :name="card.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <span class="min-w-0">
          <span class="block font-medium text-highlighted">{{ t(card.labelKey) }}</span>
          <span class="mt-1 block text-sm text-muted">{{ t(card.descriptionKey) }}</span>
        </span>
      </NuxtLink>
    </div>
  </SharedPageContainer>
</template>
