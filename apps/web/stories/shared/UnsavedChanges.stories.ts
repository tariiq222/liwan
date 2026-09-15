import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { defineComponent, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import UnsavedChanges from '../../app/components/shared/UnsavedChanges.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/UnsavedChanges',
  component: UnsavedChanges,
  parameters: { layout: 'fullscreen' },
  args: { dirty: true },
} satisfies Meta<typeof UnsavedChanges>
export default meta
type Story = StoryObj<typeof meta>

export const GuardsLeavingDirtyForm: Story = {
  name: 'داخل نموذج عند مغادرة الصفحة',
  parameters: storyContext('apps/web/app/pages/settings/users/new.vue:105'),
  render: args => ({
    components: { SettingsLayout },
    setup() {
      const router = useRouter()
      const { t } = useI18n()
      const Form = defineComponent({
        components: { FormSection, UnsavedChanges },
        setup: () => ({ args, t }),
        template: `<UForm :state="{}" class="nasq-form"><UnsavedChanges :dirty="args.dirty" /><FormSection :title="t('access.users.employee')" class="space-y-4"><UFormField :label="t('access.users.employee')" name="employee-search"><UInput class="w-full" /></UFormField></FormSection></UForm>`,
      })
      if (router.hasRoute('story-unsaved-form')) router.removeRoute('story-unsaved-form')
      router.addRoute({ name: 'story-unsaved-form', path: '/__story/unsaved-form', component: Form })
      onMounted(() => router.push('/__story/unsaved-form'))
      return { t, leave: () => router.push('/__story/elsewhere') }
    },
    template: `<main class="nasq-shell-main"><SettingsLayout width="form"><RouterView /><div><UButton color="neutral" variant="outline" data-testid="leave" @click="leave">{{ t('app.back') }}</UButton></div></SettingsLayout></main>`,
  }),
  play: async ({ canvasElement, args }) => {
    const leave = await within(canvasElement).findByTestId('leave')
    await userEvent.click(leave)
    if (args.dirty) {
      const dialog = await within(document.body).findByTestId('unsaved-changes-dialog')
      await waitFor(() => expect(dialog).toBeVisible())
    }
  },
}

export const CleanForm: Story = { ...GuardsLeavingDirtyForm, name: 'نموذج بلا تعديلات', args: { dirty: false } }
