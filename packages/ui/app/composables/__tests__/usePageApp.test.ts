import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { providePageApp, usePageApp } from '../usePageApp'

describe('usePageApp', () => {
  it('publishes the id, icon and label of the owning application to descendants', async () => {
    const app = ref({ icon: 'i-lucide-folder', id: 'projects', label: 'المشاريع', to: '/projects' })
    let seen: unknown = null
    const Child = defineComponent({ setup() { seen = usePageApp(); return () => h('span') } })
    const Parent = defineComponent({ setup() { providePageApp(app); return () => h(Child) } })
    await renderToString(createSSRApp(Parent))
    expect((seen as { value: unknown }).value).toEqual({ icon: 'i-lucide-folder', id: 'projects', label: 'المشاريع', to: '/projects' })
  })
  it('is null outside a shell', async () => {
    let seen: { value: unknown } | null = null
    await renderToString(createSSRApp(defineComponent({ setup() { seen = usePageApp(); return () => h('span') } })))
    expect(seen!.value).toBeNull()
  })
})
