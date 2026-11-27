import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ShellCallChip from '@liwan/ui/app/components/shell/ShellCallChip.vue'
import {
  provideCallChip,
  type CallChipLabels,
  type CallChipState,
} from '@liwan/ui/app/composables/useCallChip'
import { storyContext } from '../support/context'

const LABELS: CallChipLabels = {
  label: 'المكالمة',
  idle: 'الهاتف',
  ringing: number => `مكالمة من ${number}`,
  calling: number => `جارٍ الاتصال بـ ${number}`,
  inCall: duration => `في مكالمة ${duration}`,
  failed: 'تعذّرت المكالمة',
  failedHint: 'تحقق من الاتصال ثم أعد المحاولة',
  retry: 'إعادة المحاولة',
  noExtension: 'لا توجد تمثيلة مخصّصة لحسابك بعد.',
  callerCard: 'بطاقة المتصل',
  unknownCaller: 'متصل غير معروف',
  loadingCaller: 'جارٍ البحث عن المتصل…',
  recentCalls: 'آخر المكالمات',
  saveContact: 'حفظ جهة اتصال',
  answer: 'رد',
  reject: 'رفض',
  hangUp: 'إنهاء',
  mute: 'كتم',
  unmute: 'إلغاء الكتم',
  hold: 'تعليق',
  resume: 'استئناف',
  transfer: 'تحويل',
  transferPlaceholder: 'رقم أو تمثيلة للتحويل',
  transferSend: 'تحويل المكالمة',
  transferring: 'جارٍ التحويل…',
  keypad: 'لوحة الأرقام',
  dialpadTitle: 'إجراء مكالمة',
  dialPlaceholder: 'رقم الهاتف أو التمثيلة',
  dialCall: 'اتصال',
  backspace: 'حذف آخر رقم',
}

const BASE_STATE: CallChipState = {
  phase: 'registered',
  remote: null,
  registeredAs: '1001',
  since: null,
  failure: null,
  hasExtension: true,
  isLeader: true,
  muted: false,
  held: false,
  transferring: false,
  transferError: null,
  callerCard: null,
  callerCardLoading: false,
}

const KNOWN_CALLER = {
  partnerName: 'سارة العتيبي',
  companyName: 'شركة الرواد للتقنية',
  number: '+966501234567',
  recentCalls: [
    { id: 101, direction: 'واردة', state: 'تم الرد', time: 'أمس 14:20', duration: '3:15' },
    { id: 102, direction: 'صادرة', state: 'فائتة', time: '12 مارس 10:05', duration: null },
  ],
  saveContactTo: null,
}

function chipStory(overrides: Partial<CallChipState>, defaultOpen = false) {
  return () => ({
    components: { ShellCallChip },
    setup() {
      const state = ref<CallChipState>({ ...BASE_STATE, ...overrides })
      provideCallChip({
        state,
        labels: LABELS,
        actions: {
          answer: () => {
            state.value = { ...state.value, phase: 'in-call', since: Date.now() }
          },
          reject: () => {
            state.value = { ...BASE_STATE }
          },
          hangUp: () => {
            state.value = { ...BASE_STATE }
          },
          call: (number: string) => {
            if (!number.trim()) return 'أدخل رقم تمثيلة أو رقم هاتف دولي صالح.'
            state.value = { ...state.value, phase: 'calling', remote: number }
            return null
          },
          toggleMute: () => {
            state.value = { ...state.value, muted: !state.value.muted }
          },
          toggleHold: () => {
            state.value = { ...state.value, held: !state.value.held }
          },
          transfer: (target: string) => {
            if (!target.trim()) return 'أدخل رقم تمثيلة أو رقم هاتف دولي صالح.'
            return null
          },
          sendDtmf: () => {},
          retry: () => {
            state.value = { ...BASE_STATE }
          },
        },
      })
      return { defaultOpen }
    },
    template: '<div class="liwan-shell flex justify-end p-6"><ShellCallChip :default-open="defaultOpen" /></div>',
  })
}

const meta = {
  title: 'Shell/ShellCallChip',
  component: ShellCallChip,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/shell/AppTopBar.vue:56'),
  },
} satisfies Meta<typeof ShellCallChip>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
  name: 'جاهز للاتصال',
  render: chipStory({ phase: 'registered' }),
}

export const Ringing: Story = {
  name: 'مكالمة واردة',
  render: chipStory({
    phase: 'ringing',
    remote: '+966501234567',
    callerCard: KNOWN_CALLER,
  }),
}

export const Calling: Story = {
  name: 'جارٍ الاتصال',
  render: chipStory({
    phase: 'calling',
    remote: '+966501234567',
    callerCard: KNOWN_CALLER,
  }),
}

export const InCall: Story = {
  name: 'في مكالمة نشطة',
  render: chipStory({
    phase: 'in-call',
    remote: '+966501234567',
    since: Date.now() - 85_000,
    callerCard: KNOWN_CALLER,
  }, true),
}

export const MutedAndHeld: Story = {
  name: 'مكتوم ومعلّق',
  render: chipStory({
    phase: 'in-call',
    remote: '+966501234567',
    since: Date.now() - 210_000,
    muted: true,
    held: true,
    callerCard: KNOWN_CALLER,
  }, true),
}

export const UnknownCaller: Story = {
  name: 'متصل غير معروف مع حفظ جهة اتصال',
  render: chipStory({
    phase: 'ringing',
    remote: '+966559876543',
    callerCard: {
      partnerName: null,
      companyName: null,
      number: '+966559876543',
      recentCalls: [],
      saveContactTo: '/customers/new?phone=%2B966559876543&returnTo=%2Fcalls',
    },
  }, true),
}

export const NoExtension: Story = {
  name: 'بلا تمثيلة مخصّصة',
  render: chipStory({
    phase: 'idle',
    hasExtension: false,
    registeredAs: null,
  }, true),
}

export const Failed: Story = {
  name: 'تعذّر الاتصال',
  render: chipStory({
    phase: 'failed',
    failure: 'تعذّر الاتصال بخادم الاتصالات',
  }, true),
}
