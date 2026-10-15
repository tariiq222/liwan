import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import SettingsPage from '../../app/components/shared/layout/SettingsPage.vue'
import FormSection from '../../app/components/shared/layout/FormSection.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FormSection',
  component: FormSection,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
} satisfies Meta<typeof FormSection>
export default meta
type Story = StoryObj<typeof meta>

export const InForm: Story = {
  name: 'قسم داخل نموذج',
  parameters: storyContext('apps/web/app/pages/settings/users/new.vue:107'),
  render: () => ({
    components: { SettingsPage, FormSection },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><SettingsPage width="form"><UForm :state="{}" class="nasq-form"><FormSection :title="t('access.users.employee')" class="space-y-4"><UFormField :label="t('access.users.employee')" name="employee-search"><UInput class="w-full" icon="i-lucide-search" /></UFormField></FormSection></UForm></SettingsPage></main>`,
  }),
}

export const Panel: Story = {
  name: 'لوحة إعدادات',
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectCreateForm.vue:52', 'لوحة `panel` داخل `div.nasq-settings-cards` من صفحات الإعدادات؛ محتوى المثال توضيحي.'),
  render: () => ({
    components: { SettingsPage, FormSection },
    setup: () => ({ t: useI18n().t, modes: ['light', 'dark'] }),
    template: `<main class="nasq-shell-main"><SettingsPage width="form"><div class="nasq-settings-cards"><FormSection panel class="rounded-lg ring ring-default bg-default overflow-hidden" :title="t('settings.appearance.mode')" :description="t('settings.appearance.modeHint')"><URadioGroup model-value="light" variant="card" orientation="horizontal" indicator="hidden" :items="modes.map(value => ({ value, label: t('settings.appearance.' + value) }))" :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2' }" /></FormSection></div></SettingsPage></main>`,
  }),
}
