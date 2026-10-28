import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { MeetingSeriesDetailSchema } from '@webvue/contracts'

const { descriptor } = parse(readFileSync(resolve('app/pages/meetings/series/[id].vue'), 'utf8'))

// The server answers whether the caller may end the series (editor, active, manager or nothing upcoming);
// the page offers the action only on that answer, never on edit rights alone.
describe('ending a meeting series', () => {
  it('offers the action only when the server says can_end', () => {
    const script = descriptor.scriptSetup!.content
    expect(script).toMatch(/const canEndSeries = computed\(\(\) => query\.data\.value\?\.can_end === true\)/)
    expect(script).not.toMatch(/canEndSeries[^\n]*can_edit/)
    const template = descriptor.template!.content
    expect(template).toContain('v-if="canEndSeries"')
    expect(template).toContain('v-if="confirmingEnd && canEndSeries"')
  })

  it('carries can_end in the series detail contract', () => {
    const shape = MeetingSeriesDetailSchema.shape
    expect(Object.keys(shape)).toContain('can_end')
  })
})
