import { describe, expect, it } from 'vitest'
import { PRODUCT_LIMITS } from '@liwan/contracts'
import { productImageProblem } from '../productImage'

describe('productImageProblem', () => {
  it('accepts a JPEG or PNG within the size limit', () => {
    expect(productImageProblem({ type: 'image/jpeg', size: 1 })).toBeNull()
    expect(productImageProblem({ type: 'image/png', size: PRODUCT_LIMITS.imageBytes })).toBeNull()
  })

  it('refuses another type, an empty file and a file over the limit', () => {
    expect(productImageProblem({ type: 'image/gif', size: 10 })).toBe('type')
    expect(productImageProblem({ type: 'application/pdf', size: 10 })).toBe('type')
    expect(productImageProblem({ type: 'image/png', size: 0 })).toBe('empty')
    expect(productImageProblem({ type: 'image/png', size: PRODUCT_LIMITS.imageBytes + 1 })).toBe('tooLarge')
  })
})
