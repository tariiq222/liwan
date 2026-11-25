import { ProductListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const insidePath = (route: AppSidebarRoute, path: string) => {
  const current = normalizedPath(route.path)
  return current === path || current.startsWith(`${path}/`)
}

/**
 * The products sidebar: pinned create action (`new-product`), one row for the catalog,
 * and its live server count loaded with `limit: 1` under the `products` query-key root.
 */
export const productsSidebar: AppSidebarMenu = {
  create: 'new-product',
  rows: [
    {
      id: 'products', labelKey: 'products.title', icon: 'i-lucide-package', to: { path: '/products' },
      capability: 'products.read',
      active: route => insidePath(route, '/products'),
    },
  ],
  counts: [
    {
      capability: 'products.read',
      queryKey: ['products', 'list', 'sidebar'],
      async load(api: AppSearchApi) {
        const result = await api('/api/v1/products', { query: { limit: 1 }, schema: ProductListSchema })
        return { products: result.total }
      },
    },
  ],
}
