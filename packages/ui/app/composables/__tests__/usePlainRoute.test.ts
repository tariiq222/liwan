import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { providePlainRoute, usePlainRoute } from '../usePlainRoute'

async function matchAt(path: string, provided?: (path: string) => boolean): Promise<boolean> {
  let result = false
  const Child = defineComponent({ setup() { result = usePlainRoute()(path); return () => h('i') } })
  const Root = defineComponent({ setup() { if (provided) providePlainRoute(provided); return () => h(Child) } })
  await renderToString(createSSRApp(Root))
  return result
}

describe('usePlainRoute', () => {
  it('treats no route as plain until the app provides a matcher', async () => {
    expect(await matchAt('/login')).toBe(false)
  })

  it('uses the matcher the app provides', async () => {
    const matcher = (path: string) => path.startsWith('/login')
    expect(await matchAt('/login', matcher)).toBe(true)
    expect(await matchAt('/tasks', matcher)).toBe(false)
  })
})
