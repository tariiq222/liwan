import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const PaginationStub = defineComponent({ props: { page: Number, pages: Number, disabled: Boolean }, setup: props => () => h('nav', { 'data-pager': `${props.page}/${props.pages}`, 'data-disabled': props.disabled || undefined }) })
const render = (props: Record<string, unknown>) =>
  renderShared('ListFooter', { countLabel: 'Showing 2 of 9', page: 1, pages: 3, ...props }, {}, { stubs: { SharedPagination: PaginationStub as Component } })

describe('SharedListFooter', () => {
  it('shows the translated count first, then the pager', async () => {
    const html = await render({})
    expect(html.indexOf('Showing 2 of 9')).toBeLessThan(html.indexOf('data-pager="1/3"'))
    expect(html).toContain('tabular-nums')
  })

  it('keeps the count test id only when given, and passes disabled to the pager', async () => {
    expect(await render({})).not.toContain('data-testid')
    const html = await render({ countTestId: 'result-count', disabled: true })
    expect(html).toContain('data-testid="result-count"')
    expect(html).toContain('data-disabled')
  })
})
