import { rememberScrollPosition } from '../utils/scrollMemory'

// A router guard runs before the outgoing page unmounts, which is the last
// moment the document still has the leaving page's own height and offset.
// By the time scrollBehavior is called the incoming page has already rendered
// and window.scrollY has been clamped to it.
export default defineNuxtPlugin(() => {
  const router = useRouter()
  router.beforeEach((to, from) => {
    if (from.path !== to.path) rememberScrollPosition(from.fullPath, window.scrollY)
  })
})
