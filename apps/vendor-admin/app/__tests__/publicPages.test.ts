import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = (name: string) => readFileSync(fileURLToPath(new URL(`../pages/${name}.vue`, import.meta.url)), 'utf8')

describe('public pages', () => {
  it.each(['login', 'enroll'])('%s is public and outside the shell', (name) => {
    expect(page(name)).toContain('definePageMeta({ layout: false, public: true })')
  })
})
