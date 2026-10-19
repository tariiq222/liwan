import { expect, it } from 'vitest'
import { load, documentFixture } from '../../../pages/documents/__tests__/helpers'
it('allows exactly 10 MiB and rejects a larger file without starting a mutation', async () => {
  const view = await load('app/components/documents/DocumentFiles.vue', { document: documentFixture })
  const file = { name: 'boundary.txt', size: 10 * 1024 * 1024 }
  view.state.upload({ target: { files: [file], value: '' } })
  expect(view.emit).toHaveBeenCalledWith('upload', file)
  view.emit.mockClear(); view.state.upload({ target: { files: [{ ...file, size: file.size + 1 }], value: '' } })
  expect(view.emit).not.toHaveBeenCalled(); expect(view.state.uploadError.value).toBe('documents.tooLarge'); view.stop()
})
it('renders no upload control for a reader and refuses an upload entry without an allowed action', async () => {
  const view = await load('app/components/documents/DocumentFiles.vue', { document: { ...documentFixture, allowed_actions: { ...documentFixture.allowed_actions, upload_file: false } } })
  expect((await view.rendered()).some(node => node.name === 'SharedFileField')).toBe(false)
  view.state.upload({ target: { files: [{ name: 'blocked.txt', size: 1 }], value: '' } })
  expect(view.emit).not.toHaveBeenCalled(); view.stop()
})
it('shows file collection fetch failures in the page state instead of an empty list', async () => {
  const failure = new Error('File collection request failed')
  const view = await load('app/components/documents/DocumentFiles.vue', { document: documentFixture, files: [], error: failure, loading: false, pages: 1, pending: false })
  const page = (await view.rendered()).find(node => node.name === 'SharedPageState')
  expect(page?.props.error).toBe(failure)
  page?.props.onRetry()
  expect(view.emit).toHaveBeenCalledWith('retry')
  view.state.upload({ target: { files: [{ name: 'big.txt', size: 11 * 1024 * 1024 }], value: '' } })
  expect(view.state.uploadError.value).toBe('documents.tooLarge')
  expect((await view.rendered()).find(node => node.name === 'SharedPageState')?.props.error).toBe(failure)
  view.stop()
})
