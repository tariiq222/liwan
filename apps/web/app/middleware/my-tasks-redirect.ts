/**
 * The list of the personal task application lives in «أعمالي» now (owner decision 2026-11-21), as its «المهام» tab.
 * A visit to /my-tasks — a bookmark, a rail link or a browser's restored tab — forwards to that tab with the list's own
 * query kept, so a saved `?q=` or `?scope=` still narrows the same list. The record routes (/my-tasks/{id}, /new,
 * /{id}/edit) are not the list and are left alone.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.path !== '/my-tasks') return
  const { view: _view, ...rest } = to.query
  return navigateTo({ path: '/work', query: { ...rest, view: 'tasks' }, hash: to.hash }, { replace: true })
})
