import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Architecture guard: the layer keeps recipes in the shared sheets, never in a component style block.
const app = resolve(import.meta.dirname, '../../..')
describe('layer component styles live in shared sheets', () => {
  it.each(['shared/layout/SettingsPage.vue', 'shared/form/RichText.vue'])('%s has no private style block', path => {
    expect(readFileSync(resolve(app, 'components', path), 'utf8')).not.toMatch(/<style(?:\s|>)/)
  })
})
