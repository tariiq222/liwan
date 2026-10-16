import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, defineComponent, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import CreatePanel from '@webvue/ui/app/components/shared/layout/CreatePanel.vue'
import FormSection from '@webvue/ui/app/components/shared/layout/FormSection.vue'
import UnsavedChanges from '@webvue/ui/app/components/shared/form/UnsavedChanges.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/CreatePanel',
  component: CreatePanel,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  args: { title: '', backTo: '/tasks' },
} satisfies Meta<typeof CreatePanel>
export default meta
type Story = StoryObj<typeof meta>

export const Form: Story = {
  name: 'نموذج إنشاء',
  parameters: storyContext('apps/web/app/pages/tasks/new.vue:19'),
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

// The Form template (Tasmim spec §6, template 3): the route-backed panel, one UForm whose first child is
// the draft guard, a FormSection per group, the actions in #footer. The panel lives on a route so that
// closing it navigates and SharedUnsavedChanges answers that navigation, as on the app's /new routes.
export const FormTemplate: Story = {
  name: 'قالب النموذج',
  parameters: storyContext('apps/web/app/pages/settings/users/new.vue:103', 'قالب النموذج: لوحة الإنشاء المرتبطة بالمسار، وأقسام النموذج، وحماية المسودة عند الإغلاق.'),
  render: () => ({
    setup() {
      const router = useRouter()
      const { t } = useI18n()
      const Form = defineComponent({
        components: { CreatePanel, FormSection, UnsavedChanges },
        setup() {
          const state = reactive({ name: '', project: '' })
          const dirty = computed(() => Object.values(state).some(value => value.trim() !== ''))
          return { t, state, dirty }
        },
        template: `<CreatePanel :title="t('tasks.new')" back-to="/tasks">
          <UForm :state="state" class="webvue-form grid gap-6">
            <UnsavedChanges :dirty="dirty" />
            <FormSection>
              <UFormField :label="t('tasks.newTitle')" name="name" required>
                <UInput v-model="state.name" class="w-full" />
              </UFormField>
            </FormSection>
            <FormSection :title="t('tasks.detail.sectionOrganization')">
              <UFormField :label="t('tasks.project')" name="project" required>
                <UInput v-model="state.project" class="w-full" />
              </UFormField>
            </FormSection>
          </UForm>
          <template #footer>
            <div class="flex w-full flex-wrap justify-end gap-2">
              <UButton color="neutral" variant="outline" type="button">{{ t('app.cancel') }}</UButton>
              <UButton type="button">{{ t('app.create') }}</UButton>
            </div>
          </template>
        </CreatePanel>`,
      })
      if (router.hasRoute('story-form-template')) router.removeRoute('story-form-template')
      router.addRoute({ name: 'story-form-template', path: '/__story/form-template', component: Form })
      onMounted(() => router.push('/__story/form-template'))
      return {}
    },
    template: '<RouterView />',
  }),
}
