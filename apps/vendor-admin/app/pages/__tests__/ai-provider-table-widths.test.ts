import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The models table scrolls inside its container; a field in it must not be narrower than the text it holds.
const source = readFileSync(resolve(import.meta.dirname, '../ai-provider.vue'), 'utf8')

const fieldClass = (cell: string): string => {
  const block = new RegExp(`#${cell}-cell[^>]*>\\s*<(?:USelect|UInput)[^>]*class="([^"]*)"`).exec(source)
  return block![1]!
}
// Tailwind spacing: w-N is N / 4 rem.
const rem = (classes: string): number => Number(/(?:^|\s)w-(\d+)(?:\s|$)/.exec(classes)![1]) / 4

describe('the models table of the AI provider page', () => {
  it('gives the provider and model fields room for their names', () => {
    expect(rem(fieldClass('provider'))).toBeGreaterThanOrEqual(9)
    expect(rem(fieldClass('model'))).toBeGreaterThanOrEqual(13)
  })
  it('gives each price field room for a price with its decimals', () => {
    const price = /<UInput v-model="model\[field\]"[^>]*class="([^"]*)"/.exec(source)![1]!
    expect(rem(price)).toBeGreaterThanOrEqual(7)
  })
})
