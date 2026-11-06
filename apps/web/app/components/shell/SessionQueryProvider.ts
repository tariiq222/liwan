import { defineComponent, onScopeDispose, provide, type PropType } from 'vue'
import { environmentManager, VUE_QUERY_CLIENT } from '@tanstack/vue-query'
import { sessionQueryOwnerKey, useSessionQueryScope, type SessionQueryOwner } from '../../lib/sessionQueryScope'

/** Nonvisual owner boundary: descendants capture this client for their whole lifetime. */
export default defineComponent({
  props: { owner: { type: Object as PropType<SessionQueryOwner>, required: true } },
  setup(props, { slots }) {
    const scope = useSessionQueryScope()
    const owner = props.owner
    scope.bind()
    provide(VUE_QUERY_CLIENT, owner.client)
    provide(sessionQueryOwnerKey, owner)
    if (!environmentManager.isServer()) owner.client.mount()
    onScopeDispose(() => {
      if (!environmentManager.isServer()) owner.client.unmount()
      owner.client.clear()
    })
    return () => slots.default?.()
  },
})
