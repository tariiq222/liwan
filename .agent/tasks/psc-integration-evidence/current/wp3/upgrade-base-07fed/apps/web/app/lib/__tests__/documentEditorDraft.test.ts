import { describe, expect, it } from 'vitest'
import {
  shouldApplyDocumentBodyModel,
} from '../documentEditorDraft'

describe('document editor draft guard', () => {
  it('keeps a newer body draft while an unchanged-title response is delayed', async () => {
    const oldBody = '<p>Before</p>'
    const newBody = '<p>New body draft</p>'
    let resolveTitle: ((body: string) => void) | undefined
    const unchangedTitleResponse = new Promise<string>((resolve) => {
      resolveTitle = resolve
    })

    expect(shouldApplyDocumentBodyModel(newBody, oldBody, newBody)).toBe(false)
    resolveTitle?.(oldBody)
    expect(shouldApplyDocumentBodyModel(newBody, await unchangedTitleResponse, newBody)).toBe(false)
    expect(shouldApplyDocumentBodyModel(newBody, newBody, newBody)).toBe(true)
  })

  it('ignores an older consecutive body response while the latest draft is pending', () => {
    const firstBody = '<p>First save</p>'
    const latestBody = '<p>Latest save</p>'

    expect(shouldApplyDocumentBodyModel(latestBody, firstBody, latestBody)).toBe(false)
    expect(shouldApplyDocumentBodyModel(latestBody, latestBody, latestBody)).toBe(true)
  })
})
