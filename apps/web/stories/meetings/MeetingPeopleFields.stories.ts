import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MeetingPeopleFields from '../../app/components/meetings/MeetingPeopleFields.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Meetings/MeetingPeopleFields',
  component: MeetingPeopleFields,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/meetings/new.vue:174') },
  args: { attendeeIds: [7], secretaryId: null, disabled: false },
  render: args => ({
    components: { FormSection, MeetingPeopleFields, PageContainer },
    setup: () => ({ args, t: useI18n().t, attendees: ref(args.attendeeIds), secretary: ref(args.secretaryId) }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.sectionPeople')"><MeetingPeopleFields v-model:attendee-ids="attendees" v-model:secretary-id="secretary" :disabled="args.disabled" /></FormSection></form></PageContainer></main>`,
  }),
} satisfies Meta<typeof MeetingPeopleFields>
export default meta
type Story = StoryObj<typeof meta>

export const InMeetingForm: Story = { name: 'في نموذج الاجتماع' }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
