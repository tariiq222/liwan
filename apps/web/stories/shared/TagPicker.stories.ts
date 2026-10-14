import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import TagPicker from '../../app/components/shared/TagPicker.vue'
import { tags } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/TagPicker',
  component: TagPicker,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/components/project/ProjectGeneralForm.vue:190', 'اكتب اسم وسم غير موجود لرؤية خيار الإنشاء.') },
  args: { modelValue: [tags[0]!], canCreate: true },
  render: args => ({
    components: { PageContainer, TagPicker },
    setup() {
      const value = ref(args.modelValue)
      return { args, value, t: useI18n().t, onUpdate: (event: { resolved: typeof tags }) => { value.value = event.resolved } }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="form"><section class="space-y-2"><label id="project-settings-tags-label" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.settings.tags') }}</label><div id="project-settings-tags" aria-labelledby="project-settings-tags-label"><TagPicker :model-value="value" :can-create="args.canCreate" labelledby="project-settings-tags-label" @update:model-value="onUpdate" /></div></section></PageContainer></main>`,
  }),
} satisfies Meta<typeof TagPicker>
export default meta
type Story = StoryObj<typeof meta>

export const InProjectSettings: Story = { name: 'في إعدادات المشروع' }
export const WithoutCreate: Story = { name: 'بلا صلاحية إنشاء وسم', args: { modelValue: [], canCreate: false } }
