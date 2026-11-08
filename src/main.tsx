import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { NotificationProvider } from './components/Notifications'
import { SiteImageVariables } from './components/SiteImages'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function resolveAdminRoutePrefix(value: string | undefined) {
  if (!value?.trim()) return '/admin'
  const segments = value.trim().split('/').filter(Boolean)
  if (!segments.length || segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) return '/admin'
  const prefix = `/${segments.join('/')}`
  const reservedPrefixes = ['/api', '/health', '/account', '/shop', '/products', '/login', '/signup', '/cart', '/checkout']
  return reservedPrefixes.some((reserved) => prefix === reserved || prefix.startsWith(`${reserved}/`)) ? '/admin' : prefix
}

const adminRoutePrefix = resolveAdminRoutePrefix(import.meta.env.VITE_ADMIN_ROUTE_PREFIX)
const hasCustomAdminRoutePrefix = adminRoutePrefix !== '/admin'
const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
const underCustomAdminPrefix = hasCustomAdminRoutePrefix
  && (currentPath === adminRoutePrefix || currentPath.startsWith(`${adminRoutePrefix}/`))

if (underCustomAdminPrefix) {
  const entryRoute = currentPath === adminRoutePrefix ? `${adminRoutePrefix}/admin/access`
    : currentPath === `${adminRoutePrefix}/access` ? `${adminRoutePrefix}/admin/access`
      : currentPath === `${adminRoutePrefix}/activate` ? `${adminRoutePrefix}/admin/activate`
        : null
  if (entryRoute) window.history.replaceState(window.history.state, '', `${entryRoute}${window.location.search}${window.location.hash}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <NotificationProvider><SiteImageVariables /><BrowserRouter basename={underCustomAdminPrefix ? adminRoutePrefix : undefined}><App /></BrowserRouter></NotificationProvider>
    </QueryClientProvider>
  </StrictMode>,
)
