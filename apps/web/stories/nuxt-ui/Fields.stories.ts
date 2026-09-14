import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { ProjectStatusSchema } from '@nasq/contracts'

export default {
  title: 'Nuxt UI/Fields',
  parameters: { docs: { description: { component: 'وصفات `input` و`inputNumber` و`textarea` و`select` و`selectMenu` و`calendar` (فئة ``).' } } },
} satisfies Meta

export const TextInputs: StoryObj = {
  name: 'حقول النص',
  render: () => ({
    setup: () => ({ name: ref(''), count: ref(3), body: ref('') }),
    template: `<div class="nasq-form-grid">
      <UFormField :label="$t('meetingsUi.title')" name="name" required><UInput v-model="name" class="w-full" /></UFormField>
      <UFormField :label="$t('meetingsUi.title')" name="invalid" :error="$t('meetingsUx.errors.required')"><UInput class="w-full" aria-invalid="true" /></UFormField>
      <UFormField label="#" name="count"><UInputNumber v-model="count" class="w-full" /></UFormField>
      <UFormField :label="$t('projects.filters.search')" name="search"><UInput class="w-full" icon="i-lucide-search" disabled /></UFormField>
      <UFormField class="sm:col-span-2" :label="$t('meetingsUi.title')" name="body"><UTextarea v-model="body" class="w-full" :rows="3" /></UFormField>
    </div>`,
  }),
}

export const Selects: StoryObj = {
  name: 'القوائم المنسدلة',
  render: () => ({
    setup() {
      const items = ProjectStatusSchema.options
      return { items, status: ref('on_track'), statuses: ref<string[]>(['at_risk']) }
    },
    template: `<div class="nasq-form-grid">
      <UFormField :label="$t('projects.filters.allStatuses')" name="status"><USelect v-model="status" :items="items.map(value => ({ value, label: $t('projects.status.' + value) }))" class="w-full" /></UFormField>
      <UFormField :label="$t('projects.filters.allStatuses')" name="statuses"><USelectMenu v-model="statuses" multiple value-key="value" :items="items.map(value => ({ value, label: $t('projects.status.' + value) }))" class="w-full" /></UFormField>
    </div>`,
  }),
}

export const Calendar: StoryObj = {
  name: 'التقويم',
  render: () => ({ template: '<UCalendar class="w-fit" />' }),
}
