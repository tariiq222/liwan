import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as appointmentBook from '../../../composables/appointmentBook'

const file = resolve(import.meta.dirname, '../BookSlotPicker.vue')

const SLOT = { start: '2026-11-01T07:00:00Z', stop: '2026-11-01T07:30:00Z' }

/** The picker rendered with the slots query it is given; `next_date` is what the server said it stopped at. */
function render(answer: { items: (typeof SLOT)[]; total: number; next_date: string | null }) {
  const slots = { data: Vue.ref(answer), isPending: Vue.ref(false), isError: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined }
  const radio = Vue.defineComponent({
    inheritAttrs: false,
    props: { items: { type: Array, default: () => [] }, legend: String },
    setup: (props, { attrs }) => () => Vue.h('div', attrs, (props.items as { label: string }[]).map(item => Vue.h('span', item.label))),
  })
  return renderShared(file, {
    link: { id: 1, token: 'tok-1' },
    firstDate: '2026-11-01',
    lastDate: '2026-11-30',
    submitLabel: 'احجز',
    pending: false,
  }, {}, {
    modules: { '@/composables/appointmentBook': appointmentBook, '@/composables/useAppointmentBooking': { useGuestSlots: () => slots } },
    stubs: { URadioGroup: radio, SharedLoadingSkeleton: Vue.defineComponent({ setup: () => () => Vue.h('div') }) },
  })
}

describe('BookSlotPicker', () => {
  it('offers no partial notice when the answer covers the whole week', async () => {
    const html = await render({ items: [SLOT], total: 1, next_date: null })
    expect(html).not.toContain('book-slots-partial')
    expect(html).toContain('book-slots')
  })

  it('shows the days it has and a retry when the answer stopped early, instead of calling them unavailable', async () => {
    const html = await render({ items: [SLOT], total: 1, next_date: '2026-11-04' })
    expect(html).toContain('book-slots-partial')
    expect(html).toContain('appointments.book.picker.partial')
    expect(html).toContain('appointments.book.retry')
    // The day the answer did list stays selectable, so the requester can still book from what came back.
    expect(html).toContain('book-slots')
  })
})
