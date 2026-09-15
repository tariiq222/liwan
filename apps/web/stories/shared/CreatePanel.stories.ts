import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import CreatePanel from '../../app/components/shared/CreatePanel.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/CreatePanel',
  component: CreatePanel,
  parameters: { layout: 'fullscreen' },
  args: { title: '', backTo: '/tasks' },
} satisfies Meta<typeof CreatePanel>
export default meta
type Story = StoryObj<typeof meta>

export const Form: Story = {
  name: 'نموذج إنشاء',
  parameters: storyContext('apps/web/app/pages/tasks/new.vue:20'),
  render: () => ({
    components: { CreatePanel },
    setup: () => ({ t: useI18n().t }),
    template: `<CreatePanel :title="t('tasks.new')" back-to="/tasks">
      <div class="grid gap-5">
        <UFormField :label="t('tasks.newTitle')" name="name" required>
          <UInput class="w-full" />
        </UFormField>
        <UFormField :label="t('tasks.project')" name="project_id" required>
          <UInput class="w-full" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton color="neutral" variant="outline" type="button">{{ t('app.cancel') }}</UButton>
          <UButton type="button">{{ t('app.create') }}</UButton>
        </div>
      </template>
    </CreatePanel>`,
  }),
}
