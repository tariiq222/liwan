import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPage from '@liwan/ui/app/components/shared/layout/SettingsPage.vue'
import SettingsSection from '@liwan/ui/app/components/shared/layout/SettingsSection.vue'
import SettingRow from '@liwan/ui/app/components/shared/layout/SettingRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SettingsSection',
  component: SettingsSection,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قسم إعدادات بعنوان ووصف ومرساة، يسجّل عنوانه في قائمة أقسام صفحة الإعدادات.'),
  },
  args: { id: 'approvals', title: 'الاعتمادات', description: 'من يعتمد وماذا قبل الإغلاق.' },
  render: args => ({
    components: { SettingsPage, SettingsSection, SettingRow },
    setup: () => ({ args }),
    template: `<main class="liwan-shell-main"><SettingsPage>
      <SettingsSection v-bind="args">
        <SettingRow label="مراجعة الطلبات" description="يتحقق المسؤول من الطلبات قبل اعتمادها.">
          <USwitch :model-value="true" disabled aria-label="مراجعة الطلبات" />
        </SettingRow>
      </SettingsSection>
    </SettingsPage></main>`,
  }),
} satisfies Meta<typeof SettingsSection>

export default meta
type Story = StoryObj<typeof meta>
export const InSettingsPage: Story = { name: 'قسم داخل صفحة الإعدادات' }
