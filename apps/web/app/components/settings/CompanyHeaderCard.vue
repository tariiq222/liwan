<script setup lang="ts">
import type { CompanyProfile } from '@webvue/contracts'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'

// The company at the top of the company page: logo, name, the registration facts and how much of the profile is filled in.
const props = defineProps<{ profile: CompanyProfile }>()
const { t } = useI18n()
const facts = computed(() => [props.profile.company_registry, props.profile.vat].filter(Boolean).join(' · '))
const avatar = computed(() => ({ ...avatarProps(props.profile.name, props.profile.id), ...(props.profile.logo_url ? { src: props.profile.logo_url } : {}) }))
const percent = computed(() => (props.profile.completeness.total ? Math.round(props.profile.completeness.done / props.profile.completeness.total * 100) : 0))
</script>

<template>
  <SharedRecordSection variant="panel" data-testid="company-header">
    <div class="flex items-center gap-4">
      <UAvatar v-bind="avatar" size="xl" />
      <div class="min-w-0 flex-1 space-y-1.5">
        <p class="truncate text-base font-semibold text-highlighted" data-testid="company-header-name">{{ profile.name }}</p>
        <p v-if="facts" class="truncate text-sm text-muted" dir="auto">{{ facts }}</p>
      </div>
    </div>
    <div class="mt-4 space-y-1.5" data-testid="company-completeness">
      <UProgress :model-value="percent" size="sm" :aria-label="t('settings.company.completeness', { done: profile.completeness.done, total: profile.completeness.total })" />
      <p class="text-sm text-muted">{{ t('settings.company.completeness', { done: profile.completeness.done, total: profile.completeness.total }) }}</p>
    </div>
  </SharedRecordSection>
</template>
