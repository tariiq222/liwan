import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import SalesSignaturePad from '../../app/components/sales/SalesSignaturePad.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Sales/SalesSignaturePad',
  component: SalesSignaturePad,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/components/sales/SalesQuoteAnswer.vue:50', 'مربع يرسم فيه العميل توقيعه بإصبعه أو قلمه أو الفأرة، أو يكتب اسمه بلوحة المفاتيح ليصير توقيعه، وزر لمسحه.') },
  args: { disabled: false, signerName: '' },
  render: args => ({ components: { SalesSignaturePad }, setup: () => ({ args, signature: ref<string | null>(null) }), template: '<SalesSignaturePad v-bind="args" v-model="signature" />' }),
} satisfies Meta<typeof SalesSignaturePad>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { name: 'فارغ، بلا اسم' }
export const Dark: Story = {
  name: 'الوضع الداكن: الحبر يبقى داكنًا',
  args: { signerName: 'منى العتيبي' },
  globals: { appearance: 'dark' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByTestId('quote-signature-typed'))
    await waitFor(() => expect(canvas.getByTestId('quote-signature-state')).toHaveTextContent('تم التوقيع'))
    const box = canvas.getByTestId('quote-signature-pad') as HTMLCanvasElement
    const { data } = box.getContext('2d')!.getImageData(0, 0, box.width, box.height)
    const ink = Array.from({ length: data.length / 4 }, (_, pixel) => pixel * 4).filter(at => data[at + 3]! > 200)
    await expect(ink.length).toBeGreaterThan(0)
    // Every opaque pixel is dark: the picture is read on white paper whatever the theme of the page.
    await expect(ink.every(at => data[at]! < 80 && data[at + 1]! < 80 && data[at + 2]! < 90)).toBe(true)
  },
}
export const Disabled: Story = { name: 'معطّل', args: { disabled: true, signerName: 'منى العتيبي' } }
export const Keyboard: Story = {
  name: 'بلوحة المفاتيح فقط',
  args: { signerName: 'منى العتيبي' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(canvas.getByTestId('quote-signature-typed')).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(canvas.getByTestId('quote-signature-state')).toHaveTextContent('تم التوقيع'))
    await userEvent.tab()
    await expect(canvas.getByTestId('quote-signature-clear')).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByTestId('quote-signature-state')).toHaveTextContent('لا يوجد توقيع')
  },
}
