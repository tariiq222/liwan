import * as Vue from 'vue'
import { expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { load } from './helpers'
it('preserves unsaved content on 409 and refetch, then explicitly reloads the newer revision', async () => {
  const view = await load('app/pages/documents/[documentId]/edit.vue')
  view.state.draft.body = '<p>My draft</p>'
  view.data.value = { ...view.data.value, revision: 4, body: '<p>Other tab</p>' }
  await Promise.resolve()
  view.mutation.mockRejectedValueOnce(new ApiError(409, 'conflict', 'Stale'))
  await view.state.save()
  expect(view.state.draft.body).toBe('<p>My draft</p>'); expect(view.state.draft.revision).toBe(3)
  expect(view.state.conflict.value).toBe(true); expect(view.navigate).not.toHaveBeenCalled()
  await view.state.save(); expect(view.mutation).toHaveBeenCalledTimes(1)
  await view.state.reload()
  expect(view.state.draft.body).toBe('<p>Other tab</p>'); expect(view.state.draft.revision).toBe(4)
  expect(view.state.draft.isDirty()).toBe(false); view.stop()
})
it('waits for hydration, saves the original revision and returns to its record preserving list origin', async () => {
  const view = await load('app/pages/documents/[documentId]/edit.vue')
  view.state.draft.name = 'Changed'; view.hydrated.value = false
  await view.state.save(); expect(view.mutation).not.toHaveBeenCalled()
  view.hydrated.value = true; await view.state.save()
  expect(view.mutation.mock.calls[0]![0]).toMatchObject({ id: 8, patch: { expected_revision: 3, name: 'Changed' } })
  expect(view.router.resolve(view.navigate.mock.calls[0]![0]).fullPath).toBe('/documents/8?returnTo=/documents?q=policy%26offset=25%23list')
  expect(view.state.draft.isDirty()).toBe(false); view.stop()
})
it('uses authoritative allowed_actions to prevent a read-only save', async () => {
  const view = await load('app/pages/documents/[documentId]/edit.vue', {}, false)
  await view.state.save(); expect(view.mutation).not.toHaveBeenCalled()
  expect((await view.rendered()).some(node => node.name === 'SharedForbiddenState')).toBe(true)
  expect((await view.rendered()).some(node => node.name === 'DocumentEditor')).toBe(false); view.stop()
})
it('creates a restricted document without a department requirement and preserves the draft after failed creation', async () => {
  const view = await load('app/components/documents/DocumentCreateForm.vue', { backTo: '/documents?q=policy#list' })
  view.state.name.value = ' New policy '; view.state.body.value = '<p>Draft</p>'
  view.mutation.mockRejectedValueOnce(new Error('offline'))
  await view.state.submit(); expect(view.state.dirty.value).toBe(true)
  await view.state.submit()
  expect(view.mutation.mock.calls[1]![0]).toEqual({ name: 'New policy', body: '<p>Draft</p>', expiry_date: null, context: null, tag_ids: [] })
  expect(view.emit).toHaveBeenCalledWith('saved', 8); expect(view.state.dirty.value).toBe(false); view.stop()
})

it('adds the employee as a reader only when the explicit choice is made at link time', async () => {
  const share = vi.fn(async (_value: unknown) => ({}))
  const bindings = { useShareDocumentWithEmployee: () => ({ mutateAsync: share, isPending: Vue.ref(false) }) }
  const unticked = await load('app/components/documents/DocumentCreateForm.vue', { initialContext: { kind: 'hr.employee', id: 4 }, backTo: '/documents' }, true, { bindings })
  unticked.state.name.value = 'Contract'
  await unticked.state.submit()
  expect(share).not.toHaveBeenCalled(); unticked.stop()
  const ticked = await load('app/components/documents/DocumentCreateForm.vue', { initialContext: { kind: 'hr.employee', id: 4 }, backTo: '/documents' }, true, { bindings })
  ticked.state.name.value = 'Contract'; ticked.state.shareWithEmployee.value = true
  await ticked.state.submit()
  expect(share).toHaveBeenCalledWith({ id: 8, expected_revision: 4 })
  expect(ticked.emit).toHaveBeenCalledWith('saved', 8); ticked.stop()
})

it('shows title validation and clears it after correction without losing a failed-save draft', async () => {
  const view = await load('app/pages/documents/[documentId]/edit.vue')
  view.state.draft.name = ' '; await view.state.save()
  expect(view.state.titleError.value).toBe('documents.titleRequired'); expect(view.mutation).not.toHaveBeenCalled()
  view.state.draft.name = ' Corrected '; expect(view.state.titleError.value).toBeUndefined()
  view.mutation.mockRejectedValueOnce(new Error('offline')); await view.state.save()
  expect(view.state.draft.name).toBe(' Corrected '); expect(view.state.draft.isDirty()).toBe(true)
  await view.state.save(); expect(view.state.draft.isDirty()).toBe(false); view.stop()
})

it('protects a draft whose only change is its linked record, including clearing a preset', async()=>{
  const view=await load('app/components/documents/DocumentCreateForm.vue',{initialContext:{kind:'hr.department',id:2},backTo:'/documents'})
  expect(view.state.dirty.value).toBe(false)
  view.state.context.value={kind:'hr.department',id:3};expect(view.state.dirty.value).toBe(true)
  view.state.context.value=null;expect(view.state.dirty.value).toBe(true)
  view.state.context.value={kind:'hr.department',id:2};expect(view.state.dirty.value).toBe(false)
  view.stop()
})
it('focuses the required title after an empty create attempt without starting a mutation',async()=>{
  const view=await load('app/components/documents/DocumentCreateForm.vue',{backTo:'/documents'})
  // The form must leave inputs enabled for validation focus; the mutation owns busy state.
  expect((await view.rendered()).find(node => node.name === 'UForm')?.props['loading-auto']).toBe(false)
  let focused=false
  if(view.state.nameInput)view.state.nameInput.value={inputRef:{focus:()=>{focused=true}}}
  await view.state.submit()
  expect(focused).toBe(true)
  expect(view.state.titleError.value).toBe('documents.titleRequired')
  expect(view.mutation).not.toHaveBeenCalled();view.stop()
})
it('answers a non-numeric document id with the not-found state instead of an empty page', async () => {
  const view = await load('app/pages/documents/[documentId]/edit.vue', {}, true, { path: '/documents/abc/edit' })
  const state = (await view.rendered()).find(node => node.name === 'SharedPageState')
  expect(state!.props.error).toMatchObject({ status: 404 })
  view.stop()
})
