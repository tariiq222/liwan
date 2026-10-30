import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MeetingProjectFilter from '../../app/components/meetings/MeetingProjectFilter.vue'
import FormSection from '@liwan/ui/app/components/shared/layout/FormSection.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Meetings/MeetingProjectFilter',
  component: MeetingProjectFilter,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: undefined, disabled: false },
} satisfies Meta<typeof MeetingProjectFilter>
export default meta
type Story = StoryObj<typeof meta>

export const InFormField: Story = {
  name: 'داخل حقل نموذج',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/resolutions/new.vue:120'),
  render: args => ({
    components: { FormSection, MeetingProjectFilter, PageContainer },
    setup: () => ({ args, t: useI18n().t, projectId: ref(args.modelValue) }),
    template: `<main class="liwan-shell-main"><PageContainer width="form"><FormSection><div class="liwan-form-grid"><UFormField class="sm:col-span-2" :label="t('meetingMinutesForm.project')" name="project"><MeetingProjectFilter id="res-project" hide-label v-model="projectId" :disabled="args.disabled" /></UFormField></div></FormSection></PageContainer></main>`,
  }),
}

export const WithLabel: Story = {
  name: 'بعنوان ظاهر في الفلاتر',
  parameters: storyContext('apps/web/app/pages/meetings/series.vue:133'),
  args: { modelValue: 2 },
  render: args => ({
    components: { MeetingProjectFilter, PageContainer },
    setup: () => ({ args, t: useI18n().t, projectId: ref(args.modelValue) }),
    template: `<main class="liwan-shell-main"><PageContainer width="list"><div><MeetingProjectFilter id="meeting-series-project" :label="t('meetingsFilters.project')" v-model="projectId" /></div></PageContainer></main>`,
  }),
}
