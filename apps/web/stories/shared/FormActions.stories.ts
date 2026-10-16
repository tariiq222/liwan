import { useI18n } from 'vue-i18n'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import FormActions from '@webvue/ui/app/components/shared/form/FormActions.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FormActions',
  component: FormActions,
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskCreateForm.vue:268'),
} satisfies Meta<typeof FormActions>
export default meta
type Story = StoryObj<typeof meta>

export const ExplicitSave: Story = {
  render: () => ({
    components: { FormActions },
    setup: () => ({ t: useI18n().t }),
    template: `<form @submit.prevent><FormActions>
      <UButton type="button" color="neutral" variant="outline">{{ t('app.cancel') }}</UButton>
      <UButton type="submit">{{ t('app.save') }}</UButton>
    </FormActions></form>`,
  }),
}
